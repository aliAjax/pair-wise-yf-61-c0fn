import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { TranslocoPipe } from '@jsverse/transloco';
import { approveBatch, createBatch, pauseBatch, resumeBatch, telemetryTick } from './state/release.actions';
import { selectAudits, selectBatches, selectGroups } from './state/release.selectors';
import type { BatchStatus, ReleaseBatch } from './state/release.models';
import { FailureSnapshotService } from './failure-notes/failure-snapshot.service';
import { FailureNotesComponent } from './failure-notes/failure-notes.component';
import { RollbackPanelComponent } from './rollback-panel/rollback-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, MatSelectModule, MatTableModule, TranslocoPipe, FailureNotesComponent, RollbackPanelComponent],
  template: `
    <header class="hero">
      <div><span class="eyebrow">OTA CONTROL</span><h1>{{ 'title' | transloco }}</h1><p>{{ 'subtitle' | transloco }}</p></div>
      <mat-chip-set><mat-chip highlighted>审计可追踪</mat-chip><mat-chip>失败阈值自动暂停并留存快照</mat-chip></mat-chip-set>
    </header>

    <main>
      <section class="stats">
        <mat-card appearance="outlined"><span>批次数</span><strong>{{ (batches$ | async)?.length ?? 0 }}</strong></mat-card>
        <mat-card appearance="outlined"><span>兼容分组</span><strong>{{ (groups$ | async)?.length ?? 0 }}</strong></mat-card>
        <mat-card appearance="outlined"><span>已暂停</span><strong>{{ pausedCount() }}</strong></mat-card>
        <mat-card appearance="outlined"><span>审计记录</span><strong>{{ (audits$ | async)?.length ?? 0 }}</strong></mat-card>
      </section>

      <section class="grid">
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>{{ 'newBatch' | transloco }}</mat-card-title></mat-card-header>
          <mat-card-content class="form-grid">
            <mat-form-field><mat-label>批次名称</mat-label><input matInput [(ngModel)]="draft.name"></mat-form-field>
            <mat-form-field><mat-label>目标版本</mat-label><input matInput [(ngModel)]="draft.firmware"></mat-form-field>
            <mat-form-field><mat-label>回滚版本</mat-label><input matInput [(ngModel)]="draft.rollbackVersion"></mat-form-field>
            <mat-form-field><mat-label>设备分组</mat-label><mat-select [(ngModel)]="draft.groupId"><mat-option *ngFor="let group of groups$ | async" [value]="group.id" [disabled]="!group.compatible">{{ group.name }} · {{ group.region }}</mat-option></mat-select></mat-form-field>
            <mat-form-field><mat-label>灰度比例 %</mat-label><input matInput type="number" [(ngModel)]="draft.rolloutPercent"></mat-form-field>
            <mat-form-field><mat-label>失败阈值 %</mat-label><input matInput type="number" [(ngModel)]="draft.failureThreshold"></mat-form-field>
            <button mat-flat-button color="primary" (click)="create()">创建兼容批次</button>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined" class="batch-panel">
          <mat-card-header><mat-card-title>{{ 'batches' | transloco }}</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="viewport">
              <article class="batch" *ngFor="let batch of batches$ | async">
                <div class="row"><div><b>{{ batch.name }}</b><small>{{ batch.firmware }} → 回滚 {{ batch.rollbackVersion }}</small></div><mat-chip [color]="batch.status === 'paused' || batch.status === 'rolling_back' || batch.status === 'rolled_back' ? 'warn' : 'primary'" highlighted>{{ statusLabel(batch.status) }}</mat-chip></div>
                <mat-progress-bar mode="determinate" [value]="batch.progress"></mat-progress-bar>
                <div class="row"><span>{{ batch.downloaded }} 台已更新 · 失败 {{ batch.failed }} · 失败率 {{ failureRate(batch) }}% · 阈值 {{ batch.failureThreshold }}%</span><span>{{ batch.progress }}%</span></div>
                <div class="actions">
                  <button mat-stroked-button *ngIf="batch.status === 'draft'" (click)="approve(batch.id)">审批</button>
                  <button mat-stroked-button *ngIf="batch.status === 'approved'" (click)="resume(batch.id)">开始发布</button>
                  <button mat-stroked-button *ngIf="batch.status === 'running'" (click)="pause(batch.id)">暂停</button>
                  <button mat-stroked-button *ngIf="batch.status === 'paused'" [disabled]="resumeBlocked(batch)" (click)="resume(batch.id)">继续</button>
                  <small class="block-hint" *ngIf="batch.status === 'paused' && resumeBlocked(batch)">{{ resumeHint(batch) }}</small>
                  <app-rollback-panel [batch]="batch" />
                </div>
                <app-failure-notes [batch]="batch" />
              </article>
            </div>
          </mat-card-content>
        </mat-card>
      </section>

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>{{ 'audit' | transloco }}</mat-card-title></mat-card-header>
        <mat-card-content class="audit-list"><div class="audit" *ngFor="let item of audits$ | async"><span>{{ item.at | date:'MM-dd HH:mm:ss' }}</span><b>{{ item.actor }}</b><p>{{ item.message }}</p></div></mat-card-content>
      </mat-card>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100vh; background:#edf4f5; }
    .hero { padding:36px max(24px,6vw) 28px; color:#fff; background:linear-gradient(125deg,#053b46,#0f6f6c 62%,#2a9d8f); display:flex; justify-content:space-between; gap:24px; align-items:end; }
    .hero h1 { margin:8px 0; font-size:clamp(30px,4vw,52px); letter-spacing:-.04em; } .hero p { margin:0; opacity:.8 } .eyebrow { letter-spacing:.2em; font-size:12px; opacity:.7 }
    main { padding:22px max(18px,5vw) 60px; display:grid; gap:20px; } .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; } .stats span { display:block;color:#607d86 } .stats strong { font-size:30px }
    .grid { display:grid; grid-template-columns:minmax(300px,.8fr) minmax(420px,1.2fr); gap:20px; } .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding-top:16px }
    .viewport { height:540px; overflow:auto; } .batch { min-height:132px; border-bottom:1px solid #dde7e8; padding:12px 4px; display:grid; gap:10px } .row { display:flex;justify-content:space-between;gap:12px;align-items:center } small { display:block;color:#71858c } .actions { display:flex;gap:8px;flex-wrap:wrap;align-items:center }
    .block-hint { color:#9c4a22; flex-basis:100% }
    .audit-list { max-height:320px; overflow:auto } .audit { display:grid;grid-template-columns:120px 110px 1fr;border-bottom:1px solid #e5ecee;padding:10px 4px } .audit p { margin:0 }
    @media(max-width:900px){ .hero{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.audit{grid-template-columns:1fr}.viewport{height:400px} }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly snapshotService = inject(FailureSnapshotService);
  readonly groups$ = this.store.select(selectGroups);
  readonly batches$ = this.store.select(selectBatches);
  readonly audits$ = this.store.select(selectAudits);
  private timer?: number;
  draft = { name: '', firmware: '3.0.0', rollbackVersion: '2.9.2', groupId: 'g-edge', rolloutPercent: 10, failureThreshold: 3 };

  private readonly statusLabels: Record<BatchStatus, string> = {
    draft: '草稿', approved: '已审批', running: '发布中', paused: '已暂停', completed: '已完成', rolling_back: '回滚中', rolled_back: '已回滚'
  };

  ngOnInit() {
    this.timer = window.setInterval(() => this.store.dispatch(telemetryTick()), 1400);
    this.store.select(selectBatches).subscribe((batches) => localStorage.setItem('firmware-release-v1', JSON.stringify({ groups: this.snapshotGroups(), batches, audits: this.snapshotAudits() })));
  }
  ngOnDestroy() { if (this.timer) window.clearInterval(this.timer); }
  pausedCount() { let count = 0; this.batches$.subscribe((items) => count = items.filter((item) => item.status === 'paused').length); return count; }
  statusLabel(status: BatchStatus): string { return this.statusLabels[status]; }
  failureRate(batch: ReleaseBatch): string { return batch.downloaded ? (Math.round(batch.failed / batch.downloaded * 1000) / 10).toFixed(1) : '0.0'; }
  /** 继续前必须完成“填写处置说明 + 重新审批”闭环。 */
  resumeBlocked(batch: ReleaseBatch): boolean {
    return !!this.snapshotService.pendingSnapshot(batch) || this.snapshotService.awaitingReapproval(batch);
  }
  resumeHint(batch: ReleaseBatch): string {
    return this.snapshotService.awaitingReapproval(batch) ? '处置说明已提交，等待发布负责人重新审批后才能继续' : '暂停失败现场已留存，请填写失败原因与处置说明并重新审批';
  }
  create() {
    if (!this.draft.name || !this.draft.firmware || !this.draft.groupId) return;
    const batch: ReleaseBatch = { ...this.draft, id: crypto.randomUUID(), status: 'draft', progress: 0, downloaded: 0, failed: 0, failureSnapshots: [], updatedAt: new Date().toISOString() };
    this.store.dispatch(createBatch({ batch }));
    this.draft = { ...this.draft, name: '' };
  }
  approve(id: string) { this.store.dispatch(approveBatch({ id, actor: '发布负责人' })); }
  pause(id: string) { this.store.dispatch(pauseBatch({ id, actor: '值班人员' })); }
  resume(id: string) { this.store.dispatch(resumeBatch({ id, actor: '运维人员' })); }
  private snapshotGroups() { let value: unknown; this.groups$.subscribe((items) => value = items); return value; }
  private snapshotAudits() { let value: unknown; this.audits$.subscribe((items) => value = items); return value; }
}
