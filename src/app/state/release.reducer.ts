import { createReducer, on } from '@ngrx/store';
import type { AuditEntry, DeviceGroup, ReleaseBatch, ReleaseState } from './release.models';
import { approveBatch, createBatch, pauseBatch, reapproveAfterFailure, resumeBatch, rollbackBatch, submitFailureNote, telemetryTick } from './release.actions';
import { FailureSnapshotService } from '../failure-notes/failure-snapshot.service';

const initialGroups: DeviceGroup[] = [
  { id: 'g-edge', name: '华东边缘网关', region: '华东', count: 680, compatible: true, offlineGateways: 4 },
  { id: 'g-plant', name: '工业采集终端', region: '华南', count: 1240, compatible: false, offlineGateways: 12 },
  { id: 'g-clinic', name: '远程诊疗终端', region: '新加坡', count: 310, compatible: true, offlineGateways: 2 }
];
const now = new Date().toISOString();
const initialBatches: ReleaseBatch[] = [
  { id: 'batch-demo', name: '边缘网关安全补丁 2.8.1', firmware: '2.8.1', rollbackVersion: '2.7.9', groupId: 'g-edge', rolloutPercent: 20, failureThreshold: 5, status: 'approved', progress: 0, downloaded: 0, failed: 0, updatedAt: now, failureSnapshots: [] }
];
const initialAudits: AuditEntry[] = [{ id: 'audit-1', at: now, actor: '运维值班', message: '批次 batch-demo 完成兼容性检查并进入已审批' }];
const STORAGE_KEY = 'firmware-release-v1';
const fallback: ReleaseState = { groups: initialGroups, batches: initialBatches, audits: initialAudits };

const snapshots = new FailureSnapshotService();

/** 兼容旧版本持久化数据：补齐失败快照等新增字段。 */
function normalizeBatch(batch: ReleaseBatch): ReleaseBatch {
  return { ...batch, failureSnapshots: batch.failureSnapshots ?? [] };
}

function normalizeState(state: ReleaseState | null): ReleaseState | null {
  if (!state) return null;
  return { ...state, batches: (state.batches ?? []).map(normalizeBatch), audits: state.audits ?? [] };
}

const stored = typeof localStorage === 'undefined' ? null : normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as ReleaseState | null);
const initialState = stored ?? fallback;

function audit(state: ReleaseState, actor: string, message: string): AuditEntry[] {
  return [{ id: crypto.randomUUID(), at: new Date().toISOString(), actor, message }, ...state.audits];
}

function patchBatch(state: ReleaseState, id: string, patch: (batch: ReleaseBatch) => ReleaseBatch): ReleaseBatch[] {
  return state.batches.map((batch) => batch.id === id ? patch(batch) : batch);
}

export const releaseReducer = createReducer(
  initialState,
  on(createBatch, (state, { batch }) => ({ ...state, batches: [{ ...batch, failureSnapshots: batch.failureSnapshots ?? [] }, ...state.batches], audits: audit(state, '发布负责人', `创建批次 ${batch.name}`) })),
  on(approveBatch, (state, { id, actor }) => ({ ...state, batches: patchBatch(state, id, (batch) => ({ ...batch, status: 'approved', updatedAt: new Date().toISOString() })), audits: audit(state, actor, `批次 ${id} 审批通过`) })),
  on(pauseBatch, (state, { id, actor }) => ({
    ...state,
    batches: patchBatch(state, id, (batch) => batch.status !== 'running' ? batch : ({
      ...batch,
      status: 'paused',
      failureSnapshots: [...batch.failureSnapshots, snapshots.createSnapshot(batch, 'manual')],
      updatedAt: new Date().toISOString()
    })),
    audits: audit(state, actor, `批次 ${id} 已暂停，失败现场快照已留存`)
  })),
  on(resumeBatch, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch || (batch.status !== 'paused' && batch.status !== 'approved')) return state;
    // 因失败暂停的批次必须先填处置说明并重新审批才能继续；已审批批次首次开始发布不受此限
    if (batch.status === 'paused' && (snapshots.pendingSnapshot(batch) || snapshots.awaitingReapproval(batch))) return state;
    return { ...state, batches: patchBatch(state, id, (item) => ({ ...item, status: 'running', updatedAt: new Date().toISOString() })), audits: audit(state, actor, `批次 ${id} 恢复发布`) };
  }),
  on(submitFailureNote, (state, { id, note, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    const pending = batch ? snapshots.pendingSnapshot(batch) : undefined;
    const trimmed = note.trim();
    if (!batch || !pending || !trimmed) return state;
    const at = new Date().toISOString();
    return {
      ...state,
      batches: patchBatch(state, id, (item) => ({
        ...item,
        failureSnapshots: item.failureSnapshots.map((snapshot) => snapshot.id === pending.id ? { ...snapshot, note: trimmed, noteBy: actor, noteAt: at } : snapshot),
        updatedAt: at
      })),
      audits: audit(state, actor, `批次 ${id} 失败处置说明已提交，待重新审批`)
    };
  }),
  on(reapproveAfterFailure, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch || !snapshots.awaitingReapproval(batch)) return state;
    const at = new Date().toISOString();
    const latest = batch.failureSnapshots[batch.failureSnapshots.length - 1];
    return {
      ...state,
      batches: patchBatch(state, id, (item) => ({
        ...item,
        failureSnapshots: item.failureSnapshots.map((snapshot) => snapshot.id === latest.id ? { ...snapshot, reapprovedBy: actor, reapprovedAt: at } : snapshot),
        updatedAt: at
      })),
      audits: audit(state, actor, `批次 ${id} 失败处置已重新审批，可继续发布`)
    };
  }),
  on(rollbackBatch, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    // 未发布批次（草稿/已审批）不开放回滚入口；进行中或已回滚完成的批次不重复发起
    if (!batch || batch.status === 'draft' || batch.status === 'approved' || batch.status === 'rolling_back' || batch.status === 'rolled_back') return state;
    const at = new Date().toISOString();
    return {
      ...state,
      batches: patchBatch(state, id, (item) => ({
        ...item,
        status: 'rolling_back',
        rollback: { targetVersion: item.rollbackVersion, startedAt: at, startedBy: actor, rolledBack: 0, failed: 0, finishedAt: '' },
        updatedAt: at
      })),
      audits: audit(state, actor, `批次 ${id} 启动紧急回滚，目标版本 ${batch.rollbackVersion}，待回滚设备 ${batch.downloaded} 台`)
    };
  }),
  on(telemetryTick, (state) => {
    const messages: string[] = [];
    const batches = state.batches.map((batch) => {
      if (batch.status === 'running') {
        const group = state.groups.find((item) => item.id === batch.groupId);
        const target = Math.round((group?.count ?? 0) * batch.rolloutPercent / 100);
        const increment = Math.max(4, Math.round(target * 0.055));
        const downloaded = Math.min(target, batch.downloaded + increment);
        const failed = batch.failed + (Math.random() < 0.08 ? 1 : 0);
        const failureRate = downloaded ? failed / downloaded * 100 : 0;
        const next: ReleaseBatch = { ...batch, downloaded, failed, progress: target ? Math.round(downloaded / target * 100) : 0, updatedAt: new Date().toISOString() };
        if (failureRate > batch.failureThreshold) {
          const paused: ReleaseBatch = { ...next, status: 'paused' };
          messages.push(`批次 ${batch.name} 失败率 ${failureRate.toFixed(1)}% 超过阈值 ${batch.failureThreshold}%，已自动暂停并留存失败快照`);
          return { ...paused, failureSnapshots: [...paused.failureSnapshots, snapshots.createSnapshot(paused, 'threshold')] };
        }
        return { ...next, status: (downloaded >= target ? 'completed' : 'running') as ReleaseBatch['status'] };
      }
      if (batch.status === 'rolling_back' && batch.rollback) {
        const total = batch.downloaded;
        const increment = Math.max(3, Math.round(total * 0.12));
        const rolledBack = Math.min(total, batch.rollback.rolledBack + increment);
        const failed = batch.rollback.failed + (rolledBack < total && Math.random() < 0.05 ? 1 : 0);
        const done = rolledBack >= total;
        if (done) messages.push(`批次 ${batch.name} 回滚处理完成：目标版本 ${batch.rollback.targetVersion}，已回滚 ${rolledBack} 台，失败 ${failed} 台`);
        return {
          ...batch,
          status: (done ? 'rolled_back' : 'rolling_back') as ReleaseBatch['status'],
          rollback: { ...batch.rollback, rolledBack, failed, finishedAt: done ? new Date().toISOString() : '' },
          updatedAt: new Date().toISOString()
        };
      }
      return batch;
    });
    const audits = messages.reduce((entries, message) => [{ id: crypto.randomUUID(), at: new Date().toISOString(), actor: '系统', message }, ...entries], state.audits);
    return { ...state, batches, audits };
  })
);
