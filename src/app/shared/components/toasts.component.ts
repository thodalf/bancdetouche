import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <button type="button" class="toast" [attr.data-kind]="t.kind" (click)="toasts.dismiss(t.id)">{{ t.text }}</button>
      }
    </div>
  `,
})
export class ToastsComponent {
  protected readonly toasts = inject(ToastService);
}
