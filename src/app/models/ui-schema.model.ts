export interface LayoutConfig {
  direction?: 'row' | 'column';
  gap?: string;
  columns?: number;
}

export interface UINode {
  type: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, string>;
  children?: UINode[];
  layout?: LayoutConfig;
}

export interface UISchema {
  root: UINode;
}
