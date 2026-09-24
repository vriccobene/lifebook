import { fiNumberMethod, swrMethod } from "./capitalMethods";
import { hybridMethod, layersMethod, passiveIncomeMethod } from "./flowMethods";
import { runwayMethod, savingsRateMethod, yearsOfAutonomyMethod } from "./monitoringMethods";
import { baristaMethod, bridgeMethod, coastMethod, fireTiersMethod } from "./scenarioMethods";
import type { Method, MethodContext, MethodResult } from "./types";

/** An immutable, ordered set of methods. `register` returns a new registry. */
export class MethodRegistry {
  private constructor(private readonly methods: readonly Method[]) {}

  static of(methods: readonly Method[]): MethodRegistry {
    const ids = new Set<string>();
    for (const method of methods) {
      if (ids.has(method.id)) throw new Error(`Duplicate method id: ${method.id}`);
      ids.add(method.id);
    }
    return new MethodRegistry(methods);
  }

  register(method: Method): MethodRegistry {
    return MethodRegistry.of([...this.methods, method]);
  }

  list(): readonly Method[] {
    return this.methods;
  }

  get(id: string): Method | undefined {
    return this.methods.find((m) => m.id === id);
  }

  evaluateAll(ctx: MethodContext): MethodResult[] {
    return this.methods.map((method) => method.evaluate(ctx));
  }
}

export const defaultMethods: readonly Method[] = [
  swrMethod,
  fiNumberMethod,
  passiveIncomeMethod,
  hybridMethod,
  layersMethod,
  coastMethod,
  baristaMethod,
  fireTiersMethod,
  bridgeMethod,
  savingsRateMethod,
  yearsOfAutonomyMethod,
  runwayMethod,
];

export const defaultRegistry = MethodRegistry.of(defaultMethods);
