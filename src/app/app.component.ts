import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { TranslocoPipe } from '@jsverse/transloco';
import { approveBatch, approveResume, createBatch, pauseBatch, requestResume, resumeBatch, rollbackBatch, telemetryTick } from './state/release.actions';
import { selectAudits, selectBatches, selectGroups } from './state/release.selectors';
import type { BatchStatus, ReleaseBatch } from './state/release.models';

const STATUS_LABELS: Record<BatchStatus, string> = {
  draft: '草稿',
  approved: '已审批',
  running: '发布中',
  paused: '已暂停',
  rolling_back: '回滚中',
  completed: '已完成',
  rolled_back: '已回滚'
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, MatSelectModule, MatTableModule, TranslocoPipe],
  template: `
    <header class="hero">
      <div><span class="eyebrow">OTA CONTROL</span><h1>{{ 'title' | transloco }}</h1><p>{{ 'subtitle' | transloco }}</p></div>
      <mat-chip-set><mat-chip highlighted>审计可追踪</mat-chip><mat-chip>失败阈值自动暂停</mat-chip></mat-chip-set>
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
            <cdk-virtual-scroll-viewport autosize class="viewport">
              <article class="batch" *cdkVirtualFor="let batch of batches$ | async">
                <div class="row"><div><b>{{ batch.name }}</b><small>{{ batch.firmware }} → 回滚 {{ batch.rollbackVersion }}</small></div><mat-chip [color]="isWarn(batch.status) ? 'warn' : 'primary'" highlighted>{{ statusLabel(batch.status) }}</mat-chip></div>
                <mat-progress-bar mode="determinate" [value]="batch.progress" [color]="batch.status === 'rolling_back' ? 'warn' : 'primary'"></mat-progress-bar>
                <div class="row"><span>{{ batch.downloaded }} 台已更新 · 失败 {{ batch.failed }} · 阈值 {{ batch.failureThreshold }}%</span><span>{{ batch.progress }}%</span></div>

                <div class="snapshot" *ngIf="batch.failureSnapshot">
                  <b>失败快照（暂停时保存）</b>
                  <small>{{ batch.failureSnapshot.at | date:'MM-dd HH:mm:ss' }} · 失败率 {{ batch.failureSnapshot.failureRate | number:'1.1-1' }}% / 阈值 {{ batch.failureSnapshot.threshold }}% · 已更新 {{ batch.failureSnapshot.downloaded }} 台 · 失败 {{ batch.failureSnapshot.failed }} 台</small>
                  <ul><li *ngFor="let event of batch.failureSnapshot.recentFailures">{{ event }}</li><li *ngIf="batch.failureSnapshot.recentFailures.length === 0">无单设备失败明细</li></ul>
                </div>

                <div class="resume-box" *ngIf="batch.status === 'paused'">
                  <ng-container *ngIf="!batch.resumeRequest">
                    <div class="row"><b>暂停处置：填写说明并提交重新审批后才能继续</b><small *ngIf="batch.pauseReason === 'failure'">失败率超阈值自动暂停</small><small *ngIf="batch.pauseReason === 'manual'">手动暂停</small></div>
                    <mat-form-field class="full"><mat-label>处理人</mat-label><input matInput [(ngModel)]="handlerNotes[batch.id].handler" [ngModelOptions]="{standalone: true}"></mat-form-field>
                    <mat-form-field class="full"><mat-label>处置说明（必填，提交后进入重新审批）</mat-label><textarea matInput rows="2" [(ngModel)]="handlerNotes[batch.id].note" [ngModelOptions]="{standalone: true}"></textarea></mat-form-field>
                    <button mat-stroked-button (click)="submitResume(batch.id)" [disabled]="!handlerNotes[batch.id].handler.trim() || !handlerNotes[batch.id].note.trim()">提交处置说明并申请继续</button>
                  </ng-container>
                  <ng-container *ngIf="batch.resumeRequest as req">
                    <div class="row" *ngIf="!req.approved">
                      <b>继续发布申请待审批</b><mat-chip color="warn" highlighted>待重新审批</mat-chip>
                    </div>
                    <div class="row" *ngIf="req.approved">
                      <b>重新审批已通过，可继续发布</b><mat-chip color="primary" highlighted>已批准</mat-chip>
                    </div>
                    <small>处理人：{{ req.handler }} · {{ req.at | date:'MM-dd HH:mm:ss' }}<ng-container *ngIf="req.approver"> · 审批人：{{ req.approver }}（{{ req.approvedAt | date:'MM-dd HH:mm:ss' }}）</ng-container></small>
                    <p class="note">处置说明：{{ req.note }}</p>
                  </ng-container>
                </div>

                <div class="rollback-box" *ngIf="batch.rollback as rb">
                  <b>紧急回滚记录</b>
                  <small>目标版本：{{ rb.targetVersion }} · 已更新设备 {{ rb.total }} 台 · 已回滚 {{ rb.rolledBack }} 台 · 失败 {{ rb.failed }} 台<ng-container *ngIf="rb.finishedAt"> · 完成于 {{ rb.finishedAt | date:'MM-dd HH:mm:ss' }}</ng-container></small>
                  <mat-progress-bar mode="determinate" [value]="rb.total ? (rb.rolledBack + rb.failed) / rb.total * 100 : 0"></mat-progress-bar>
                </div>

                <div class="actions">
                  <button mat-stroked-button *ngIf="batch.status === 'draft'" (click)="approve(batch.id)">审批</button>
                  <button mat-stroked-button *ngIf="batch.status === 'approved'" (click)="resume(batch.id)">开始发布</button>
                  <button mat-stroked-button *ngIf="batch.status === 'running'" (click)="pause(batch.id)">暂停</button>
                  <button mat-stroked-button color="primary" *ngIf="batch.status === 'paused' && batch.resumeRequest && !batch.resumeRequest.approved" (click)="reapprove(batch.id)">重新审批</button>
                  <button mat-flat-button color="primary" *ngIf="batch.status === 'paused' && batch.resumeRequest?.approved" (click)="resume(batch.id)">继续发布</button>
                  <ng-container *ngIf="canRollback(batch)">
                    <button mat-flat-button color="warn" [disabled]="batch.status === 'rolling_back'" (click)="rollback(batch.id)">
                      {{ batch.status === 'rolling_back' ? '回滚进行中…' : '紧急回滚' }}
                    </button>
                  </ng-container>
                </div>
              </article>
            </cdk-virtual-scroll-viewport>
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
    .viewport { height:560px; } .batch { min-height:132px; border-bottom:1px solid #dde7e8; padding:12px 4px; display:grid; gap:10px } .row { display:flex;justify-content:space-between;gap:12px;align-items:center } small { display:block;color:#71858c } .actions { display:flex;gap:8px;flex-wrap:wrap }
    .snapshot { background:#fdecec; border:1px solid #f3b9b9; border-radius:8px; padding:10px 12px; display:grid; gap:6px } .snapshot ul { margin:0; padding-left:18px; max-height:96px; overflow:auto } .snapshot li { font-size:12px; color:#8a2f2f }
    .resume-box { background:#fff7e6; border:1px solid #f0d28a; border-radius:8px; padding:10px 12px; display:grid; gap:6px } .resume-box .full { width:100% } .resume-box .note { margin:0; font-size:13px }
    .rollback-box { background:#fdf0f4; border:1px solid #ecc0cd; border-radius:8px; padding:10px 12px; display:grid; gap:6px }
    .audit-list { max-height:320px; overflow:auto } .audit { display:grid;grid-template-columns:120px 110px 1fr;border-bottom:1px solid #e5ecee;padding:10px 4px } .audit p { margin:0 }
    @media(max-width:900px){ .hero{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.audit{grid-template-columns:1fr}.viewport{height:420px} }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  readonly groups$ = this.store.select(selectGroups);
  readonly batches$ = this.store.select(selectBatches);
  readonly audits$ = this.store.select(selectAudits);
  readonly pausedCount = signal(0);
  private timer?: number;
  private viewed = new Set<string>();
  handlerNotes: Record<string, { handler: string; note: string }> = {};
  draft = { name: '', firmware: '3.0.0', rollbackVersion: '2.9.2', groupId: 'g-edge', rolloutPercent: 10, failureThreshold: 3 };

  ngOnInit() {
    this.timer = window.setInterval(() => this.store.dispatch(telemetryTick()), 1400);
    this.batches$.subscribe((batches) => {
      this.pausedCount.set(batches.filter((item) => item.status === 'paused').length);
      for (const batch of batches) {
        if (!this.viewed.has(batch.id)) {
          this.viewed.add(batch.id);
          this.handlerNotes[batch.id] = { handler: '', note: '' };
        }
      }
      localStorage.setItem('firmware-release-v1', JSON.stringify({ groups: this.snapshotGroups(), batches, audits: this.snapshotAudits() }));
    });
  }
  ngOnDestroy() { if (this.timer) window.clearInterval(this.timer); }
  statusLabel(status: BatchStatus) { return STATUS_LABELS[status] ?? status; }
  isWarn(status: BatchStatus) { return status === 'paused' || status === 'rolling_back' || status === 'rolled_back'; }
  /** 未发布批次（草稿、尚未开始的已审批批次，无已更新设备）不开放回滚入口 */
  canRollback(batch: ReleaseBatch) {
    return batch.downloaded > 0 && batch.status !== 'completed' && batch.status !== 'rolled_back';
  }
  create() {
    if (!this.draft.name || !this.draft.firmware || !this.draft.groupId) return;
    const batch: ReleaseBatch = { ...this.draft, id: crypto.randomUUID(), status: 'draft', progress: 0, downloaded: 0, failed: 0, updatedAt: new Date().toISOString() };
    this.store.dispatch(createBatch({ batch }));
    this.draft = { ...this.draft, name: '' };
  }
  approve(id: string) { this.store.dispatch(approveBatch({ id, actor: '发布负责人' })); }
  pause(id: string) { this.store.dispatch(pauseBatch({ id, actor: '值班人员', reason: 'manual' })); }
  submitResume(id: string) {
    const form = this.handlerNotes[id];
    if (!form?.handler.trim() || !form.note.trim()) return;
    this.store.dispatch(requestResume({ id, handler: form.handler, note: form.note }));
  }
  reapprove(id: string) { this.store.dispatch(approveResume({ id, approver: '发布负责人' })); }
  resume(id: string) { this.store.dispatch(resumeBatch({ id, actor: '运维人员' })); }
  rollback(id: string) { this.store.dispatch(rollbackBatch({ id, actor: '值班人员' })); }
  private snapshotGroups() { let value: unknown; this.groups$.subscribe((items) => value = items); return value; }
  private snapshotAudits() { let value: unknown; this.audits$.subscribe((items) => value = items); return value; }
}
