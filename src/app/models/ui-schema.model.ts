export interface LayoutConfig {
  direction?: 'row' | 'column';
  gap?: string;
  columns?: number;
}

export interface ButtonOutputs {
  action?: string;
  message?: string;
}

export type UIOutputs = ButtonOutputs;

export interface UINode {
  type: string;
  inputs?: Record<string, unknown>;
  outputs?: UIOutputs;
  children?: UINode[];
  layout?: LayoutConfig;
}

export interface UISchema {
  root: UINode;
}
