import { InjectionToken, Provider, Type } from "@angular/core";

export const DYNAMIC_COMPONENT_REGISTRY = new InjectionToken<Map<string, Type<unknown>>>('DYNAMIC_COMPONENT_REGISTRY');

export const dynamicComponentRegistry = new Map<string, Type<unknown>>();

export const provideDynamicComponentRegistry = (): Provider => ({
  provide: DYNAMIC_COMPONENT_REGISTRY,
  useValue: dynamicComponentRegistry
});
