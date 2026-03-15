import { Component, effect, inject, input, ViewContainerRef } from '@angular/core';
import { DYNAMIC_COMPONENT_REGISTRY } from '../../providers/provideDynamicComponentRegistry';
import { UINode, UISchema } from '../../models/ui-schema.model';

@Component({
  selector: 'app-dynamic-renderer',
  imports: [],
  templateUrl: './dynamic-renderer.component.html',
  styleUrl: './dynamic-renderer.component.scss'
})
export class DynamicRendererComponent {
  public components = inject(DYNAMIC_COMPONENT_REGISTRY);
  private vcr = inject(ViewContainerRef);

  schema = input<UISchema | null>(null);
  node = input<UINode | null>(null);
  maxDepth = input(8);


  constructor() {
    effect(() => {
      this.vcr.clear();
      const rootNode = this.node() ?? this.schema()?.root;

      if (!rootNode) return;

      this.renderNode(rootNode, 0);
    });
  }

  private renderNode(node: UINode, depth: number): void {
    if (depth > this.maxDepth()) return;

    const component = this.components.get(node.type);

    if (!component) return;

    const ref = this.vcr.createComponent(component);

    for (const [key, value] of Object.entries(node.inputs ?? {})) {
      ref.setInput(key, value);
    }

    if (node.layout) {
      ref.setInput('layout', node.layout);
    }

    if (node.children?.length) {
      ref.setInput('children', node.children);
    }
  }

}
