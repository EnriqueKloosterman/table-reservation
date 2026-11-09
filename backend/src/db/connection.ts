import mongoose from "mongoose";

type InitializableModel = { init(): Promise<unknown> };

const models: InitializableModel[] = [];

/** Adds a model to the registry whose indexes `initModels()` builds before serving requests. */
export function registerModel<M extends InitializableModel>(model: M): M {
  models.push(model);
  return model;
}

/** Builds the indexes of every registered model (unique indexes must exist before writes). */
export async function initModels(): Promise<void> {
  await Promise.all(models.map((m) => m.init()));
}

export async function connectDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseUp(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
