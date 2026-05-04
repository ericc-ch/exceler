import { NodeHttpClient, NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { LlamaCpp } from "./lib/llama-cpp.ts"

const main = Effect.gen(function* () {
  const llamaCpp = yield* LlamaCpp
  yield* llamaCpp.install
})

const Layers = Layer.empty.pipe(
  Layer.merge(LlamaCpp.layer),
  Layer.provide(NodeServices.layer),
  Layer.provide(NodeHttpClient.layerFetch),
)

NodeRuntime.runMain(main.pipe(Effect.provide(Layers)))
