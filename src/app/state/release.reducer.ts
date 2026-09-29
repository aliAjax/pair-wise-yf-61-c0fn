import { createReducer, on } from '@ngrx/store';
import type { AuditEntry, DeviceGroup, ReleaseBatch, ReleaseState } from './release.models';
import { approveBatch, approveResume, createBatch, pauseBatch, requestResume, resumeBatch, rollbackBatch, telemetryTick } from './release.actions';

const initialGroups: DeviceGroup[] = [
  { id: 'g-edge', name: '华东边缘网关', region: '华东', count: 680, compatible: true, offlineGateways: 4 },
  { id: 'g-plant', name: '工业采集终端', region: '华南', count: 1240, compatible: false, offlineGateways: 12 },
  { id: 'g-clinic', name: '远程诊疗终端', region: '新加坡', count: 310, compatible: true, offlineGateways: 2 }
];
const now = new Date().toISOString();
const initialBatches: ReleaseBatch[] = [
  { id: 'batch-demo', name: '边缘网关安全补丁 2.8.1', firmware: '2.8.1', rollbackVersion: '2.7.9', groupId: 'g-edge', rolloutPercent: 20, failureThreshold: 5, status: 'approved', progress: 0, downloaded: 0, failed: 0, updatedAt: now }
];
const initialAudits: AuditEntry[] = [{ id: 'audit-1', at: now, actor: '运维值班', message: '批次 batch-demo 完成兼容性检查并进入已审批' }];
const STORAGE_KEY = 'firmware-release-v1';
const fallback: ReleaseState = { groups: initialGroups, batches: initialBatches, audits: initialAudits };
const stored = typeof localStorage === 'undefined' ? fallback : JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as ReleaseState | null;
const initialState = stored ?? fallback;

function audit(state: ReleaseState, actor: string, message: string): AuditEntry[] {
  return [{ id: crypto.randomUUID(), at: new Date().toISOString(), actor, message }, ...state.audits];
}

const FAILURE_STAGES = ['下载失败', '安装失败', '重启后校验失败'];

function randomFailure(batch: ReleaseBatch): string {
  const deviceId = `dev-${batch.id.slice(0, 8)}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const stage = FAILURE_STAGES[Math.floor(Math.random() * FAILURE_STAGES.length)];
  return `${new Date().toISOString()} ${deviceId} ${stage}`;
}

/** 回滚按已更新设备逐台推进，模拟少量回滚失败，全部处理完才结束 */
function advanceRollback(batch: ReleaseBatch): ReleaseBatch {
  const record = batch.rollback!;
  const remaining = record.total - record.rolledBack - record.failed;
  if (remaining <= 0) return batch;
  const increment = Math.min(remaining, Math.max(4, Math.round(record.total * 0.08)));
  const failedNow = Math.random() < 0.06 ? 1 : 0;
  const rolledBack = record.rolledBack + (increment - failedNow);
  const failed = record.failed + failedNow;
  const done = rolledBack + failed >= record.total;
  return {
    ...batch,
    status: done ? 'rolled_back' : 'rolling_back',
    updatedAt: new Date().toISOString(),
    rollback: { ...record, rolledBack, failed, finishedAt: done ? new Date().toISOString() : undefined }
  };
}

export const releaseReducer = createReducer(
  initialState,
  on(createBatch, (state, { batch }) => ({ ...state, batches: [batch, ...state.batches], audits: audit(state, '发布负责人', `创建批次 ${batch.name}`) })),
  on(approveBatch, (state, { id, actor }) => ({
    ...state,
    batches: state.batches.map((batch) => batch.id === id && batch.status === 'draft' ? { ...batch, status: 'approved', updatedAt: new Date().toISOString() } : batch),
    audits: audit(state, actor, `批次 ${id} 审批通过`)
  })),
  on(pauseBatch, (state, { id, actor, reason }) => {
    const target = state.batches.find((batch) => batch.id === id);
    if (!target || target.status !== 'running') return state;
    return {
      ...state,
      batches: state.batches.map((batch) => batch.id === id ? { ...batch, status: 'paused', pauseReason: reason, updatedAt: new Date().toISOString() } : batch),
      audits: audit(state, actor, reason === 'failure' ? `批次 ${id} 失败率超过阈值，已自动暂停` : `批次 ${id} 已手动暂停`)
    };
  }),
  on(requestResume, (state, { id, handler, note }) => {
    const target = state.batches.find((batch) => batch.id === id);
    const trimmed = note.trim();
    if (!target || target.status !== 'paused' || !handler.trim() || !trimmed) return state;
    const at = new Date().toISOString();
    const snapshotNote = target.failureSnapshot
      ? `（暂停现场：已更新 ${target.failureSnapshot.downloaded} 台、失败 ${target.failureSnapshot.failed} 台、失败率 ${target.failureSnapshot.failureRate.toFixed(1)}%）`
      : '';
    return {
      ...state,
      batches: state.batches.map((batch) => batch.id === id ? { ...batch, resumeRequest: { handler: handler.trim(), note: trimmed, at, approved: false }, updatedAt: at } : batch),
      audits: audit(state, handler.trim(), `批次 ${id} 处置人提交继续申请并说明：${trimmed}${snapshotNote}，等待重新审批`)
    };
  }),
  on(approveResume, (state, { id, approver }) => {
    const target = state.batches.find((batch) => batch.id === id);
    if (!target || target.status !== 'paused' || !target.resumeRequest || target.resumeRequest.approved) return state;
    const approvedAt = new Date().toISOString();
    return {
      ...state,
      batches: state.batches.map((batch) => batch.id === id ? { ...batch, resumeRequest: { ...batch.resumeRequest!, approved: true, approver, approvedAt }, updatedAt: approvedAt } : batch),
      audits: audit(state, approver, `批次 ${id} 处置说明已重新审批通过，允许继续发布`)
    };
  }),
  on(resumeBatch, (state, { id, actor }) => {
    const target = state.batches.find((batch) => batch.id === id);
    if (!target) return state;
    // 已审批批次可以开始发布；暂停批次必须处置说明重新审批通过后才能继续
    if (target.status === 'approved') {
      return {
        ...state,
        batches: state.batches.map((batch) => batch.id === id ? { ...batch, status: 'running', updatedAt: new Date().toISOString() } : batch),
        audits: audit(state, actor, `批次 ${id} 开始发布`)
      };
    }
    if (target.status !== 'paused' || !target.resumeRequest?.approved) return state;
    return {
      ...state,
      batches: state.batches.map((batch) => batch.id === id
        ? { ...batch, status: 'running', pauseReason: undefined, failureSnapshot: undefined, resumeRequest: undefined, recentFailures: [], updatedAt: new Date().toISOString() }
        : batch),
      audits: audit(state, actor, `批次 ${id} 重新审批后恢复发布`)
    };
  }),
  on(rollbackBatch, (state, { id, actor }) => {
    const target = state.batches.find((batch) => batch.id === id);
    // 未发布（草稿、已审批但未开始）以及已结束的批次不开放回滚入口
    if (!target || target.downloaded === 0 || !['running', 'paused'].includes(target.status)) return state;
    return {
      ...state,
      batches: state.batches.map((batch) => batch.id === id ? {
        ...batch,
        status: 'rolling_back',
        updatedAt: new Date().toISOString(),
        rollback: { startedAt: new Date().toISOString(), targetVersion: batch.rollbackVersion, total: batch.downloaded, rolledBack: 0, failed: 0 }
      } : batch),
      audits: audit(state, actor, `批次 ${id} 启动紧急回滚，目标版本 ${target.rollbackVersion}，需回滚 ${target.downloaded} 台已更新设备`)
    };
  }),
  on(telemetryTick, (state) => {
    const failurePauses: ReleaseBatch[] = [];
    const rollbackDones: ReleaseBatch[] = [];
    const batches = state.batches.map((batch) => {
      if (batch.status === 'rolling_back') {
        const next = advanceRollback(batch);
        if (next.status === 'rolled_back') rollbackDones.push(next);
        return next;
      }
      if (batch.status !== 'running') return batch;
      const group = state.groups.find((item) => item.id === batch.groupId);
      const target = Math.round((group?.count ?? 0) * batch.rolloutPercent / 100);
      const increment = Math.max(4, Math.round(target * 0.055));
      const downloaded = Math.min(target, batch.downloaded + increment);
      const failedThisTick = Math.random() < 0.08 ? 1 : 0;
      const failed = batch.failed + failedThisTick;
      const failureRate = downloaded ? failed / downloaded * 100 : 0;
      const recentFailures = failedThisTick ? [...(batch.recentFailures ?? []), randomFailure(batch)].slice(-8) : batch.recentFailures;
      if (failureRate > batch.failureThreshold) {
        const paused: ReleaseBatch = {
          ...batch,
          downloaded,
          failed,
          recentFailures,
          progress: target ? Math.round(downloaded / target * 100) : 0,
          status: 'paused',
          pauseReason: 'failure',
          failureSnapshot: { at: new Date().toISOString(), downloaded, failed, failureRate, threshold: batch.failureThreshold, recentFailures: recentFailures ?? [] },
          updatedAt: new Date().toISOString()
        };
        failurePauses.push(paused);
        return paused;
      }
      const status: ReleaseBatch['status'] = downloaded >= target ? 'completed' : 'running';
      return { ...batch, downloaded, failed, recentFailures, progress: target ? Math.round(downloaded / target * 100) : 0, status, updatedAt: new Date().toISOString() };
    });
    let audits = state.audits;
    const systemAudits: AuditEntry[] = [];
    for (const item of failurePauses) {
      const snapshot = item.failureSnapshot!;
      systemAudits.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        actor: '系统',
        message: `批次 ${item.id} 失败率 ${snapshot.failureRate.toFixed(1)}% 超过阈值 ${snapshot.threshold}%，已自动暂停；失败现场：已更新 ${snapshot.downloaded} 台、失败 ${snapshot.failed} 台、最近失败 ${snapshot.recentFailures.length} 起`
      });
    }
    for (const item of rollbackDones) {
      const record = item.rollback!;
      systemAudits.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        actor: '系统',
        message: `批次 ${item.id} 紧急回滚完成，目标版本 ${record.targetVersion}：已回滚 ${record.rolledBack} 台、失败 ${record.failed} 台`
      });
    }
    if (systemAudits.length) audits = [...systemAudits, ...audits];
    return { ...state, batches, audits };
  })
);
