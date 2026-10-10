/** Build a reproducible blind packet from three engine outputs; never synthesizes missing results. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir)
  throw new Error(
    "usage: compare.mts <three-engine-output-directory> <private-output-directory>",
  );
const manifest = JSON.parse(
  await readFile(new URL("./manifest.json", import.meta.url), "utf8"),
);
const arms = ["legacy", "structured_once", "pi_research"];
const outputs = await Promise.all(
  arms.map(async (engine) => {
    const data = JSON.parse(
      await readFile(resolve(inputDir, engine + ".json"), "utf8"),
    );
    if (
      data.engine !== engine ||
      data.model !== "deepseek-flash" ||
      data.unit !== "single_event" ||
      data.fixtureSha256 !== manifest.frozenSha256 ||
      !Array.isArray(data.events)
    )
      throw new Error("incompatible_engine_output:" + engine);
    if (
      !Array.isArray(data.runs) ||
      !data.runs.length ||
      data.runs.some(
        (r) =>
          !r.id ||
          !Number.isSafeInteger(r.totalCostMicros) ||
          r.totalCostMicros < 0 ||
          r.totalCostMicros > 10000000 ||
          Number(r.reservedMicros || 0) !== 0 ||
          !["review", "completed"].includes(r.state),
      )
    )
      throw new Error("invalid_run_cost:" + engine);
    if (
      data.totalCostMicros !==
      data.runs.reduce((sum, r) => sum + r.totalCostMicros, 0)
    )
      throw new Error("cost_total_mismatch:" + engine);
    if (
      data.events.some(
        (e) =>
          !e.eventKey ||
          !e.markdown ||
          !/^\d{4}-\d{2}-\d{2}$/.test(e.window || "") ||
          !Array.isArray(e.materialIds) || !e.materialIds.length ||
          e.error ||
          !Number.isFinite(e.elapsedMs) ||
          e.elapsedMs < 0,
      )
    )
      throw new Error("incomplete_output:" + engine);
    return data;
  }),
);
const ids = outputs[0].events.map((e) => e.eventKey);
if (new Set(ids).size !== ids.length || ids.length < 20)
  throw new Error("need_at_least_20_unique_events");
for (const output of outputs)
  if (
    output.events.length !== ids.length ||
    output.events.some((e) => !ids.includes(e.eventKey))
  )
    throw new Error("different_event_sets");
for(const output of outputs.slice(1)) for(const event of output.events) {
 const first=outputs[0].events.find(e=>e.eventKey===event.eventKey);
 if(first.window!==event.window || JSON.stringify([...first.materialIds].sort())!==JSON.stringify([...event.materialIds].sort()))throw new Error('different_material_scope');
}
const packetHash=createHash('sha256').update(JSON.stringify(outputs)).digest('hex');
try {
 const previous=JSON.parse(await readFile(resolve(outputDir,'blind-review.json'),'utf8'));
 if(previous.packetHash!==packetHash)throw new Error('existing_review_has_different_inputs_use_new_directory');
 await readFile(resolve(outputDir,'answer-key.json'));await readFile(resolve(outputDir,'costs.json'));
 console.log('Existing identical packet retained; human choices unchanged.');process.exit(0);
} catch(error) {
 if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
}
const answerKey: unknown[] = [];
const packet = ids.map((eventKey: string, index: number) => {
  const shuffled = outputs
    .map((o) => ({
      engine: o.engine,
      event: o.events.find((e) => e.eventKey === eventKey),
    }))
    .sort((a, b) =>
      createHash("sha256")
        .update(manifest.frozenSha256 + eventKey + a.engine)
        .digest("hex")
        .localeCompare(
          createHash("sha256")
            .update(manifest.frozenSha256 + eventKey + b.engine)
            .digest("hex"),
        ),
    );
  answerKey.push({
    eventKey,
    variants: shuffled.map((s, i) => ({
      label: String.fromCharCode(65 + i),
      engine: s.engine,
    })),
  });
  return {
    number: index + 1,
    eventKey,
    variants: shuffled.map((s, i) => ({
      label: String.fromCharCode(65 + i),
      markdown: s.event.markdown,
    })),
    chosen: null,
    tie: false,
    severeFactError: false,
    editingSeconds: null,
    notes: "",
  };
});
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await writeFile(
  resolve(outputDir, "blind-review.json"),
  JSON.stringify(
    {
      packetHash,
      fixtureSha256:manifest.frozenSha256,
      instructions:
        "每事件选择更可用稿，平局不算新稿获选；记录严重事实错误与修改时间。人工验收完成前不得自动填chosen。",
      events: packet,
    },
    null,
    2,
  ),
  { mode: 0o600, flag:"wx" },
);
await writeFile(
  resolve(outputDir, "answer-key.json"),
  JSON.stringify(answerKey, null, 2),
  { mode: 0o600, flag:"wx" },
);
await writeFile(
  resolve(outputDir, "costs.json"),
  JSON.stringify(
    outputs.map((o) => ({
      engine: o.engine,
      totalCostMicros: o.totalCostMicros,
    })),
    null,
    2,
  ),
  { mode: 0o600, flag:"wx" },
);
console.log("Blind packet created; human choices pending.");
