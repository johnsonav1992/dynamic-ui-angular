import { Component, input } from '@angular/core';
import { DynamicComponent } from '../../decorators/dynamic-component';
import { DynamicRendererComponent } from '../dynamic-renderer/dynamic-renderer.component';
import { LayoutConfig, UINode } from '../../models/ui-schema.model';

@DynamicComponent('container')
@Component({
  selector: 'app-container',
  imports: [DynamicRendererComponent],
  templateUrl: './container.component.html',
  styleUrl: './container.component.scss'
})
export class ContainerComponent {
  children = input<UINode[]>([]);
  layout = input<LayoutConfig>({});

  protected gridTemplate(): string | null {
    const columns = this.layout().columns;
    return columns ? `repeat(${columns}, minmax(0, 1fr))` : null;
  }
}
