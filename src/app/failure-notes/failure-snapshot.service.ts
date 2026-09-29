import { Injectable } from '@angular/core';
import type { FailureSnapshot, ReleaseBatch } from '../state/release.models';

/**
 * 失败快照的纯函数助手：暂停时留存失败现场，供 reducer 与页面共用。
 */
@Injectable({ providedIn: 'root' })
export class FailureSnapshotService {
  createSnapshot(batch: ReleaseBatch, reason: FailureSnapshot['reason'], at: string = new Date().toISOString()): FailureSnapshot {
    return {
      id: crypto.randomUUID(),
      at,
      reason,
      downloaded: batch.downloaded,
      failed: batch.failed,
      failureRate: batch.downloaded ? Math.round(batch.failed / batch.downloaded * 1000) / 10 : 0,
      threshold: batch.failureThreshold,
      note: '',
      noteBy: '',
      noteAt: '',
      reapprovedBy: '',
      reapprovedAt: ''
    };
  }

  /** 暂停且存在未填写处置说明的快照时，必须留痕并重新审批后才能继续。 */
  pendingSnapshot(batch: ReleaseBatch): FailureSnapshot | undefined {
    if (batch.status !== 'paused') return undefined;
    const latest = batch.failureSnapshots[batch.failureSnapshots.length - 1];
    return latest && !latest.note ? latest : undefined;
  }

  /** 快照已填写说明但尚未重新审批。 */
  awaitingReapproval(batch: ReleaseBatch): boolean {
    if (batch.status !== 'paused') return false;
    const latest = batch.failureSnapshots[batch.failureSnapshots.length - 1];
    return !!latest && !!latest.note && !latest.reapprovedBy;
  }
}
