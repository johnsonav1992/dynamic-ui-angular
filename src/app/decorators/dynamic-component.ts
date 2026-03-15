import { Type } from "@angular/core";
import { dynamicComponentRegistry } from "../providers/provideDynamicComponentRegistry";

export const DynamicComponent = (type: string): ClassDecorator => {
  return function (target: Function) {
    dynamicComponentRegistry.set(type, target as Type<unknown>);
  };
};
