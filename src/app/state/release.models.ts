export type BatchStatus = 'draft' | 'approved' | 'running' | 'paused' | 'rolling_back' | 'completed' | 'rolled_back';

export type PauseReason = 'manual' | 'failure';

export interface DeviceGroup {
  id: string;
  name: string;
  region: string;
  count: number;
  compatible: boolean;
  offlineGateways: number;
}

/** 失败率超阈值自动暂停时留存的失败现场 */
export interface FailureSnapshot {
  at: string;
  downloaded: number;
  failed: number;
  failureRate: number;
  threshold: number;
  recentFailures: string[];
}

/** 暂停后处理人填写的处置说明，需重新审批通过才能继续发布 */
export interface ResumeRequest {
  handler: string;
  note: string;
  at: string;
  approved: boolean;
  approver?: string;
  approvedAt?: string;
}

/** 紧急回滚过程记录：按已更新设备推进，完成后才结束 */
export interface RollbackRecord {
  startedAt: string;
  targetVersion: string;
  total: number;
  rolledBack: number;
  failed: number;
  finishedAt?: string;
}

export interface ReleaseBatch {
  id: string;
  name: string;
  firmware: string;
  rollbackVersion: string;
  groupId: string;
  rolloutPercent: number;
  failureThreshold: number;
  status: BatchStatus;
  progress: number;
  downloaded: number;
  failed: number;
  updatedAt: string;
  recentFailures?: string[];
  pauseReason?: PauseReason;
  failureSnapshot?: FailureSnapshot;
  resumeRequest?: ResumeRequest;
  rollback?: RollbackRecord;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  message: string;
}

export interface ReleaseState {
  groups: DeviceGroup[];
  batches: ReleaseBatch[];
  audits: AuditEntry[];
}
