import { createAction, props } from '@ngrx/store';
import type { ReleaseBatch } from './release.models';

export const createBatch = createAction('[Release] Create batch', props<{ batch: ReleaseBatch }>());
export const approveBatch = createAction('[Release] Approve batch', props<{ id: string; actor: string }>());
export const pauseBatch = createAction('[Release] Pause batch', props<{ id: string; actor: string }>());
export const resumeBatch = createAction('[Release] Resume batch', props<{ id: string; actor: string }>());
export const rollbackBatch = createAction('[Release] Rollback batch', props<{ id: string; actor: string }>());
export const submitFailureNote = createAction('[Release] Submit failure note', props<{ id: string; note: string; actor: string }>());
export const reapproveAfterFailure = createAction('[Release] Reapprove after failure', props<{ id: string; actor: string }>());
export const telemetryTick = createAction('[Release] Telemetry tick');
