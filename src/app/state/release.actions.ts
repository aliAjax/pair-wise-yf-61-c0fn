import { createAction, props } from '@ngrx/store';
import type { ReleaseBatch } from './release.models';

export const createBatch = createAction('[Release] Create batch', props<{ batch: ReleaseBatch }>());
export const approveBatch = createAction('[Release] Approve batch', props<{ id: string; actor: string }>());
export const pauseBatch = createAction('[Release] Pause batch', props<{ id: string; actor: string; reason: 'manual' | 'failure' }>());
/** 暂停后处理人提交处置说明，等待重新审批 */
export const requestResume = createAction('[Release] Request resume', props<{ id: string; handler: string; note: string }>());
/** 重新审批通过后才允许继续发布 */
export const approveResume = createAction('[Release] Approve resume', props<{ id: string; approver: string }>());
export const resumeBatch = createAction('[Release] Resume batch', props<{ id: string; actor: string }>());
export const rollbackBatch = createAction('[Release] Rollback batch', props<{ id: string; actor: string }>());
export const telemetryTick = createAction('[Release] Telemetry tick');
