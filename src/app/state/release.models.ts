export type BatchStatus = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'rolling_back' | 'rolled_back';

export interface DeviceGroup {
  id: string;
  name: string;
  region: string;
  count: number;
  compatible: boolean;
  offlineGateways: number;
}

export interface FailureSnapshot {
  id: string;
  at: string;
  reason: 'threshold' | 'manual';
  downloaded: number;
  failed: number;
  failureRate: number;
  threshold: number;
  note: string;
  noteBy: string;
  noteAt: string;
  reapprovedBy: string;
  reapprovedAt: string;
}

export interface RollbackRecord {
  targetVersion: string;
  startedAt: string;
  startedBy: string;
  rolledBack: number;
  failed: number;
  finishedAt: string;
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
  failureSnapshots: FailureSnapshot[];
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
