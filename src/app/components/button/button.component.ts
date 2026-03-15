import { Component, input } from '@angular/core';
import { DynamicComponent } from '../../decorators/dynamic-component';

@DynamicComponent('button')
@Component({
  selector: 'app-button',
  imports: [],
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss'
})
export class ButtonComponent {
  label = input<string>('Continue');
}
