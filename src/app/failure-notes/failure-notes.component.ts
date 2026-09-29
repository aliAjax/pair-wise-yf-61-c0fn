import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { reapproveAfterFailure, submitFailureNote } from '../state/release.actions';
import { FailureSnapshotService } from './failure-snapshot.service';
import type { FailureSnapshot, ReleaseBatch } from '../state/release.models';

@Component({
  selector: 'app-failure-notes',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatChipsModule, MatFormFieldModule, MatInputModule],
  template: `
    <section class="failure" *ngIf="snapshots().length">
      <h4>失败处置（{{ snapshots().length }} 次暂停）</h4>
      <article class="snapshot" *ngFor="let snapshot of snapshots(); trackBy: trackSnapshot">
        <div class="snapshot-head">
          <mat-chip [color]="snapshot.reason === 'threshold' ? 'warn' : 'primary'" highlighted>
            {{ snapshot.reason === 'threshold' ? '失败率超阈值自动暂停' : '手动暂停' }}
          </mat-chip>
          <span>{{ snapshot.at | date:'MM-dd HH:mm:ss' }}</span>
        </div>
        <p class="scene">
          失败现场：已更新 {{ snapshot.downloaded }} 台 · 失败 {{ snapshot.failed }} 台 ·
          失败率 {{ snapshot.failureRate }}% · 阈值 {{ snapshot.threshold }}%
        </p>
        <div class="note" *ngIf="snapshot.note; else noteForm">
          <p><b>{{ snapshot.noteBy }}</b>（{{ snapshot.noteAt | date:'MM-dd HH:mm:ss' }}）：{{ snapshot.note }}</p>
          <p class="reapproval" *ngIf="snapshot.reapprovedBy; else awaitingChip">
            <mat-chip color="primary" highlighted>已重新审批</mat-chip>
            {{ snapshot.reapprovedBy }} 于 {{ snapshot.reapprovedAt | date:'MM-dd HH:mm:ss' }} 审批，可继续发布
          </p>
          <ng-template #awaitingChip>
            <span class="awaiting">
              <mat-chip color="warn" highlighted>待重新审批</mat-chip>
              <button mat-stroked-button color="primary" (click)="reapprove(snapshot)">重新审批通过</button>
            </span>
          </ng-template>
        </div>
        <ng-template #noteForm>
          <div class="note-form" *ngIf="isLatest(snapshot)">
            <mat-form-field appearance="outline" class="full">
              <mat-label>失败原因与处置说明（必填，提交后需重新审批才能继续）</mat-label>
              <textarea matInput rows="2" [(ngModel)]="noteText"></textarea>
            </mat-form-field>
            <div class="note-actions">
              <mat-form-field appearance="outline">
                <mat-label>处理人</mat-label>
                <input matInput [(ngModel)]="noteActor">
              </mat-form-field>
              <button mat-flat-button color="primary" [disabled]="!noteText().trim()" (click)="submit(snapshot)">提交说明</button>
            </div>
          </div>
          <p class="awaiting" *ngIf="!isLatest(snapshot)"><mat-chip color="warn" highlighted>历史快照处置信息缺失</mat-chip></p>
        </ng-template>
      </article>
    </section>
  `,
  styles: [`
    .failure { border:1px dashed #d8926b; border-radius:8px; padding:10px 12px; margin-top:8px; background:#fdf6f1 }
    h4 { margin:0 0 8px; font-size:13px; color:#9c4a22 }
    .snapshot { padding:8px 0; border-bottom:1px solid #efdccd }
    .snapshot:last-child { border-bottom:none }
    .snapshot-head { display:flex; justify-content:space-between; align-items:center; gap:8px; color:#71858c; font-size:12px }
    .scene { margin:6px 0; font-size:12px; color:#5d4037 }
    .note p { margin:4px 0; font-size:13px }
    .note .reapproval, .awaiting { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; color:#607d86 }
    .note-form { display:grid; gap:6px } .full { width:100% }
    .note-actions { display:flex; gap:10px; align-items:center }
    ::ng-deep .note-actions .mat-mdc-form-field { width:160px }
  `]
})
export class FailureNotesComponent {
  private readonly store = inject(Store);
  private readonly snapshotService = inject(FailureSnapshotService);
  readonly batch = input.required<ReleaseBatch>();

  readonly noteText = signal('');
  readonly noteActor = signal('值班人员');
  readonly snapshots = computed(() => [...this.batch().failureSnapshots].reverse());

  isLatest(snapshot: FailureSnapshot): boolean {
    const list = this.batch().failureSnapshots;
    return list.length > 0 && list[list.length - 1].id === snapshot.id;
  }

  submit(snapshot: FailureSnapshot): void {
    const text = this.noteText().trim();
    if (!text) return;
    this.store.dispatch(submitFailureNote({ id: this.batch().id, note: text, actor: this.noteActor().trim() || '值班人员' }));
    this.noteText.set('');
  }

  reapprove(snapshot: FailureSnapshot): void {
    if (!this.isLatest(snapshot) || !snapshot.note || snapshot.reapprovedBy) return;
    this.store.dispatch(reapproveAfterFailure({ id: this.batch().id, actor: '发布负责人' }));
  }

  trackSnapshot(_index: number, snapshot: FailureSnapshot): string {
    return snapshot.id;
  }
}
