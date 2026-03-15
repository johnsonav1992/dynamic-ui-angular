import { Component, input } from '@angular/core';
import { DynamicComponent } from '../../decorators/dynamic-component';

@DynamicComponent('tag')
@Component({
  selector: 'app-tag',
  imports: [],
  templateUrl: './tag.component.html',
  styleUrl: './tag.component.scss'
})
export class TagComponent {
  text = input<string>('Info');
  tone = input<'neutral' | 'success' | 'warning'>('neutral');
}
