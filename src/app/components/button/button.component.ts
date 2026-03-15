import { Component, input } from '@angular/core';
import { DynamicComponent } from '../../decorators/dynamic-component';
import { ButtonOutputs } from '../../models/ui-schema.model';

@DynamicComponent('button')
@Component({
  selector: 'app-button',
  imports: [],
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss'
})
export class ButtonComponent {
  label = input<string>('Continue');
  outputs = input<ButtonOutputs>({});

  protected handleClick(): void {
    const action = this.outputs().action?.trim();
    const message = this.outputs().message?.trim();
    if (!action || typeof window === 'undefined') return;

    window.dispatchEvent(
      new CustomEvent('dynamic-ui-action', {
        detail: {
          action,
          message,
          label: this.label(),
        },
      }),
    );
  }
}
