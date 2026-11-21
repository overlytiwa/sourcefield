import { useCallback, useEffect, useState } from "react";
import { X, Plus, RefreshCw, ArrowUpRight, Trash2 } from "lucide-react";
import type { CodeMap, MapNode, ViewState } from "../../shared/types";
import {
  anchorFor,
  resolveAnchor,
  emptyWorkbench,
} from "../../shared/workbench";
import type {
  ChangeReport,
  FeatureEntry,
  Investigation,
  Observation,
  PortableWorkbench,
  WorkbenchState,
} from "../../shared/workbench";
type Tab =
  | "Changes"
  | "Features"
  | "Investigations"
  | "Activity"
  | "Architecture"
  | "Debug"
  | "Tours";
export function Workbench({
  map,
  selected,
  onSelect,
  onFocus,
  onClose,
  capture,
  onRestore,
  notify,
}: {
  map: CodeMap;
  selected: string | null;
  onSelect: (id: string) => void;
  onFocus: (ids: string[]) => void;
  onClose: () => void;
  capture: () => ViewState | undefined;
  onRestore: (view: ViewState) => void;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("Changes"),
    [state, setState] = useState<WorkbenchState>({
      data: map.workbench ?? emptyWorkbench(),
      activity: [],
      edits: [],
      stale: false,
      watching: false,
    });
  const [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [base, setBase] = useState("HEAD"),
    [changes, setChanges] = useState<ChangeReport | null>(null),
    [coupling, setCoupling] = useState<any>(null);
  const [current, setCurrent] = useState(""),
    [title, setTitle] = useState(""),
    [architecture, setArchitecture] = useState<any>(null),
    [from, setFrom] = useState("src/"),
    [to, setTo] = useState("electron/");
  const [format, setFormat] = useState<"stack" | "coverage" | "trace">("stack"),
    [text, setText] = useState(""),
    [observations, setObservations] = useState<{
      observations: Observation[];
      unmatched: string[];
    } | null>(null);
  const [tourId, setTourId] = useState(""),
    [tourStep, setTourStep] = useState(0),
    [stepNote, setStepNote] = useState("");
  const call = useCallback(
    (action: string, args: Record<string, unknown> = {}) =>
      window.sourcefield!.workbench(action, args),
    [],
  );
  const load = useCallback(async () => {
    try {
      setState(await call("state"));
    } catch (e) {
      setError(String(e));
    }
  }, [call]);
  useEffect(() => {
    void load();
    setChanges(null);
    setObservations(null);
  }, [map, load]);
  useEffect(() => {
    if (tab !== "Activity") return;
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [tab, load]);
  async function run(action: () => Promise<void>) {
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }
  async function save(data: PortableWorkbench) {
    setState(await call("save", { data }));
  }
  const data = state.data,
    work = data.investigations.find((w) => w.id === current),
    tour = data.tours.find((t) => t.id === tourId),
    node = map.nodes.find((n) => n.id === selected),
    index = new Map(map.nodes.map((n) => [n.id, n]));
  const nodeButton = (id: string, detail?: string) => (
    <button
      className="work-node"
      key={id + detail}
      onClick={() => onSelect(id)}
    >
      <strong>{index.get(id)?.name ?? "Missing symbol"}</strong>
      <small>{detail ?? index.get(id)?.path}</small>
    </button>
  );
  async function updateWork(next: Investigation) {
    await save({
      ...data,
      investigations: data.investigations.map((w) =>
        w.id === next.id ? next : w,
      ),
    });
  }
  async function copyContext() {
    const context = await call("context", { id: work!.id });
    await navigator.clipboard.writeText(JSON.stringify(context, null, 2));
    notify("Investigation context copied. It is also available through MCP.");
  }
  return (
    <aside className="workbench-panel" aria-label="Developer workbench">
      <div className="workbench-top">
        <strong>Workbench</strong>
        <button
          className="icon-button"
          aria-label="Close workbench"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <nav className="workbench-tabs" aria-label="Workbench tools">
        {(
          [
            "Changes",
            "Features",
            "Investigations",
            "Activity",
            "Architecture",
            "Debug",
            "Tours",
          ] as Tab[]
        ).map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="workbench-body" aria-busy={working}>
        {error && (
          <p className="work-error" role="alert">
            {error}
          </p>
        )}
        {working && <p role="status">Working…</p>}
        <fieldset className="workbench-fields" disabled={working}>
          {tab === "Changes" && (
            <>
              <h2>Review your changes</h2>
              <p>
                Compare the current scan with a Git revision. HEAD includes
                staged, unstaged and untracked source changes.
              </p>
              <label>
                Base revision
                <input
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="HEAD or main"
                />
              </label>
              <button
                className="button primary"
                disabled={working}
                onClick={() =>
                  run(async () => {
                    setChanges(await call("changes", { base }));
                  })
                }
              >
                Compare changes
              </button>
              {changes && (
                <>
                  <p>
                    {changes.files.length} changed files ·{" "}
                    {changes.changed.length} changed nodes ·{" "}
                    {changes.impacted.length} potential consumers
                  </p>
                  <p className="work-note">
                    {changes.note}
                    {changes.capped ? " Results are capped." : ""}
                  </p>
                  <button
                    className="button subtle"
                    onClick={() =>
                      onFocus([
                        ...changes.changed,
                        ...changes.impacted.map((i) => i.node_id),
                      ])
                    }
                  >
                    Show impact on map
                  </button>
                  <details open>
                    <summary>Changed symbols and files</summary>
                    {changes.changed.slice(0, 100).map((id) => nodeButton(id))}
                    {changes.removed.map((n, i) => (
                      <p key={i}>
                        Removed: {n.path} · {n.name}
                      </p>
                    ))}
                  </details>
                  <details open>
                    <summary>Potential impact and tests</summary>
                    {changes.impacted.map((i) => (
                      <div key={i.node_id}>
                        {nodeButton(
                          i.node_id,
                          `${i.test ? "Test · " : ""}${i.entry ? "Entry point · " : ""}${i.reason}`,
                        )}
                        <small className="work-evidence">
                          {i.via
                            .map((id) => {
                              const e = map.edges.find((e) => e.id === id);
                              return e
                                ? `${index.get(e.source)?.name} ${e.kind} ${index.get(e.target)?.name}`
                                : "Base-revision relationship";
                            })
                            .join("; ")}
                        </small>
                      </div>
                    ))}
                  </details>
                  <details>
                    <summary>Architecture changes</summary>
                    <p>
                      {changes.architecture?.new_cycles.length ?? 0} introduced
                      cycles ·{" "}
                      {changes.architecture?.introduced_violations.length ?? 0}{" "}
                      new rule violations
                    </p>
                    {changes.architecture?.introduced_violations.map((v) =>
                      nodeButton(v.source, v.rule),
                    )}
                    {changes.addedEdges.map((e, i) => (
                      <p key={"a" + i}>
                        Added {e.kind}: {e.source} to {e.target}
                      </p>
                    ))}
                    {changes.removedEdges.map((e, i) => (
                      <p key={"r" + i}>
                        Removed {e.kind}: {e.source} to {e.target}
                      </p>
                    ))}
                  </details>
                  <button
                    className="button subtle"
                    disabled={working}
                    onClick={() =>
                      run(async () =>
                        setCoupling(
                          await call("coupling", {
                            paths: changes.files.map((f) => f.path),
                          }),
                        ),
                      )
                    }
                  >
                    Find files that changed together
                  </button>
                  {coupling && (
                    <>
                      <p>{coupling.note}</p>
                      {coupling.results.map((r: any) => (
                        <details key={r.path}>
                          <summary>
                            {r.path} · {r.count} shared commits
                          </summary>
                          {r.commits.map((sha: string) => (
                            <code className="commit-sha" key={sha}>
                              {sha}
                            </code>
                          ))}
                        </details>
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          )}
          {tab === "Features" && (
            <>
              <h2>Follow a behaviour</h2>
              <p>
                Explicit UI actions, routes, commands, message handlers and
                background tasks. Each entry includes its source evidence.
              </p>
              {!map.features?.length && (
                <p>No supported registrations found in this scan.</p>
              )}
              {map.features?.map((f) => (
                <div className="work-card" key={f.id}>
                  <small>{f.kind}</small>
                  <button
                    className="work-node"
                    onClick={() => onSelect(f.node_id)}
                  >
                    <strong>{f.name}</strong>
                    <small>
                      {f.path}:{f.line}
                    </small>
                  </button>
                  <code>{f.evidence}</code>
                  <button
                    className="button subtle"
                    onClick={() => {
                      const neighbors = map.edges
                        .filter(
                          (e) =>
                            e.source === f.node_id || e.target === f.node_id,
                        )
                        .flatMap((e) => [e.source, e.target]);
                      onFocus([f.node_id, ...f.target_ids, ...neighbors]);
                    }}
                  >
                    Explore connected code
                  </button>
                </div>
              ))}
            </>
          )}
          {tab === "Investigations" && (
            <>
              <h2>Keep a task in view</h2>
              <div className="work-inline">
                <input
                  aria-label="Investigation title"
                  placeholder="Add refunds"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <button
                  className="icon-button"
                  disabled={!title.trim() || working}
                  aria-label="Create investigation"
                  onClick={() =>
                    run(async () => {
                      const id = crypto.randomUUID();
                      await save({
                        ...data,
                        investigations: [
                          ...data.investigations,
                          {
                            id,
                            title: title.trim(),
                            nodes: [],
                            notes: "",
                            questions: "",
                          },
                        ],
                      });
                      setCurrent(id);
                      setTitle("");
                    })
                  }
                >
                  <Plus size={16} />
                </button>
              </div>
              <select
                aria-label="Saved investigations"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              >
                <option value="">Choose an investigation</option>
                {data.investigations.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
              {work && (
                <>
                  <h3>{work.title}</h3>
                  <button
                    className="button subtle"
                    disabled={
                      !node ||
                      work.nodes.some((a) => a.id === node.id) ||
                      working
                    }
                    onClick={() =>
                      run(() =>
                        updateWork({
                          ...work,
                          nodes: [...work.nodes, anchorFor(node!)],
                        }),
                      )
                    }
                  >
                    Add selected node{node ? " · " + node.name : ""}
                  </button>
                  {work.nodes.map((a) => {
                    const match = resolveAnchor(map, a);
                    return (
                      <div className="work-inline" key={a.id}>
                        <button
                          className="work-node"
                          disabled={!match.node}
                          onClick={() => onSelect(match.node!.id)}
                        >
                          <strong>{a.name}</strong>
                          <small>
                            {a.path} · {match.status}
                          </small>
                        </button>
                        <button
                          className="icon-button"
                          aria-label={"Remove " + a.name}
                          onClick={() =>
                            run(() =>
                              updateWork({
                                ...work,
                                nodes: work.nodes.filter((n) => n.id !== a.id),
                              }),
                            )
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <label>
                    Notes
                    <textarea
                      key={work.id + "notes"}
                      defaultValue={work.notes}
                      onBlur={(e) =>
                        void run(() =>
                          updateWork({ ...work, notes: e.target.value }),
                        )
                      }
                    />
                  </label>
                  <label>
                    Open questions
                    <textarea
                      key={work.id + "questions"}
                      defaultValue={work.questions}
                      onBlur={(e) =>
                        void run(() =>
                          updateWork({ ...work, questions: e.target.value }),
                        )
                      }
                    />
                  </label>
                  <button
                    className="button subtle"
                    onClick={() =>
                      run(async () => {
                        await updateWork({ ...work, view: capture() });
                        notify("View saved.");
                      })
                    }
                  >
                    Save current view
                  </button>
                  {work.view && (
                    <button
                      className="button subtle"
                      onClick={() => onRestore(work.view!)}
                    >
                      Restore saved view
                    </button>
                  )}
                  <button
                    className="button subtle"
                    onClick={() =>
                      onFocus(
                        work.nodes.flatMap((a) => {
                          const n = resolveAnchor(map, a).node;
                          return n ? [n.id] : [];
                        }),
                      )
                    }
                  >
                    Focus investigation
                  </button>
                  <button
                    className="button primary"
                    disabled={working}
                    onClick={() => run(copyContext)}
                  >
                    Copy context for AI
                  </button>
                  <button
                    className="button subtle"
                    disabled={working}
                    onClick={() =>
                      run(async () => {
                        const context = await call("context", { id: work.id });
                        const candidates = context.suggestions.items
                          .filter(
                            (i: any) =>
                              !work.nodes.some((a) => a.id === i.node_id),
                          )
                          .slice(0, 20);
                        notify(
                          candidates.length
                            ? `${candidates.length} connected candidates shown on the map. Select and add the ones relevant to your task.`
                            : "No additional resolved consumers found.",
                        );
                        onFocus([
                          ...work.nodes.map((a) => a.id),
                          ...candidates.map((i: any) => i.node_id),
                        ]);
                      })
                    }
                  >
                    Suggest connected code
                  </button>
                  <button
                    className="button subtle"
                    onClick={() =>
                      run(async () => {
                        await save({
                          ...data,
                          investigations: data.investigations.filter(
                            (w) => w.id !== work.id,
                          ),
                        });
                        setCurrent("");
                      })
                    }
                  >
                    Delete investigation
                  </button>
                </>
              )}
            </>
          )}
          {tab === "Activity" && (
            <>
              <h2>Observed AI activity</h2>
              <select
                aria-label="Planned investigation scope"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              >
                <option value="">
                  Compare edits with a planned investigation
                </option>
                {data.investigations.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
              {work && (
                <p>
                  {
                    state.edits.filter(
                      (p) => !work.nodes.some((a) => a.path === p),
                    ).length
                  }{" "}
                  edited paths are outside this investigation’s selected files.
                </p>
              )}
              <p>
                Only requests made through Sourcefield are recorded. A read does
                not establish understanding or authorship of an edit.
              </p>
              <p>
                {state.watching
                  ? "Watching source changes."
                  : "Source watcher unavailable; use Refresh."}{" "}
                {state.edits.length} source paths observed in project activity.
              </p>
              <details open>
                <summary>Source edits</summary>
                {state.edits.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </details>
              {[...state.activity].reverse().map((a, i) => (
                <div className="work-card" key={i}>
                  <strong>
                    {a.tool} · {a.ok ? "completed" : "failed"}
                  </strong>
                  <small>{new Date(a.at).toLocaleString()}</small>
                  {a.node_ids.map((id) => nodeButton(id))}
                  {a.paths.map((p) => (
                    <small key={p}>{p}</small>
                  ))}
                  {a.ranges?.map((r, i) => (
                    <small key={i}>
                      Read {r.path}:{r.start}–{r.end ?? r.start}
                    </small>
                  ))}
                  {a.edge_ids?.length ? (
                    <small>
                      {a.edge_ids.length} relationship records inspected
                    </small>
                  ) : null}
                </div>
              ))}
            </>
          )}
          {tab === "Architecture" && (
            <>
              <h2>Guard project boundaries</h2>
              <p>
                Rules prohibit relationships from one path prefix to another.
                Dependency cycles are based on file imports.
              </p>
              <label>
                From path prefix
                <input value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                To path prefix
                <input value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <button
                className="button subtle"
                disabled={!from || !to || working}
                onClick={() =>
                  run(() =>
                    save({
                      ...data,
                      rules: [
                        ...data.rules,
                        {
                          id: crypto.randomUUID(),
                          title: `${from} must not import ${to}`,
                          from,
                          to,
                          kind: "imports",
                        },
                      ],
                    }).then(() => {}),
                  )
                }
              >
                Add import boundary rule
              </button>
              {data.rules.map((r) => (
                <div className="work-inline" key={r.id}>
                  <p>{r.title}</p>
                  <button
                    className="icon-button"
                    aria-label="Delete rule"
                    onClick={() =>
                      run(() =>
                        save({
                          ...data,
                          rules: data.rules.filter((x) => x.id !== r.id),
                        }).then(() => {}),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                className="button primary"
                disabled={working}
                onClick={() =>
                  run(async () => setArchitecture(await call("architecture")))
                }
              >
                Check architecture
              </button>
              {architecture && (
                <>
                  <h3>{architecture.violations.length} violations</h3>
                  {architecture.violations.map((v: any) =>
                    nodeButton(
                      v.source,
                      `${v.rule} · ${v.path ?? ""}:${v.line ?? ""}`,
                    ),
                  )}
                  <h3>{architecture.cycles.length} import cycles</h3>
                  {architecture.cycles.map((cycle: string[], i: number) => (
                    <div className="work-card" key={i}>
                      <button
                        className="button subtle"
                        onClick={() => onFocus(cycle)}
                      >
                        Show cycle
                      </button>
                      {cycle.map((id) => nodeButton(id))}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
          {tab === "Debug" && (
            <>
              <h2>Locate observed execution</h2>
              <p>
                Paste a stack trace, LCOV coverage, or OTLP JSON. Traces need
                code.file.path or code.filepath attributes to map to source.
              </p>
              <select
                aria-label="Observation format"
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
              >
                <option value="stack">Stack trace</option>
                <option value="coverage">LCOV coverage</option>
                <option value="trace">OpenTelemetry JSON</option>
              </select>
              <textarea
                aria-label="Observation text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste recording…"
              />
              <button
                className="button primary"
                disabled={!text || working}
                onClick={() =>
                  run(async () =>
                    setObservations(
                      await call("observations", { format, text }),
                    ),
                  )
                }
              >
                Locate on map
              </button>
              <button
                className="button subtle"
                disabled={working}
                onClick={() =>
                  run(async () => {
                    const value = await call("import-observations", { format });
                    if (value) setObservations(value);
                  })
                }
              >
                Import a file
              </button>
              {observations && (
                <>
                  <p>
                    {observations.observations.length} mapped observations ·{" "}
                    {observations.unmatched.length} unmatched examples
                  </p>
                  <button
                    className="button subtle"
                    onClick={() =>
                      onFocus(observations.observations.map((o) => o.node_id))
                    }
                  >
                    Show observed code
                  </button>
                  {observations.observations.slice(0, 200).map((o, i) => (
                    <div className="work-card" key={i}>
                      {nodeButton(o.node_id, o.label)}
                      <small>{o.detail}</small>
                    </div>
                  ))}
                  <details>
                    <summary>Unmatched source</summary>
                    {observations.unmatched.map((m, i) => (
                      <p key={i}>{m}</p>
                    ))}
                  </details>
                </>
              )}
            </>
          )}
          {tab === "Tours" && (
            <>
              <h2>Explain a code path</h2>
              <div className="work-inline">
                <input
                  aria-label="Tour title"
                  placeholder="How authentication works"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <button
                  className="icon-button"
                  aria-label="Create tour"
                  disabled={!title.trim() || working}
                  onClick={() =>
                    run(async () => {
                      const id = crypto.randomUUID();
                      await save({
                        ...data,
                        tours: [
                          ...data.tours,
                          { id, title: title.trim(), steps: [] },
                        ],
                      });
                      setTourId(id);
                      setTourStep(0);
                      setTitle("");
                    })
                  }
                >
                  <Plus size={16} />
                </button>
              </div>
              <select
                aria-label="Saved tours"
                value={tourId}
                onChange={(e) => {
                  setTourId(e.target.value);
                  setTourStep(0);
                }}
              >
                <option value="">Choose a tour</option>
                {data.tours.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              {tour && (
                <>
                  <label>
                    Step explanation
                    <textarea
                      value={stepNote}
                      onChange={(e) => setStepNote(e.target.value)}
                    />
                  </label>
                  <button
                    className="button subtle"
                    disabled={!node || working}
                    onClick={() =>
                      run(async () => {
                        await save({
                          ...data,
                          tours: data.tours.map((t) =>
                            t.id === tour.id
                              ? {
                                  ...t,
                                  steps: [
                                    ...t.steps,
                                    {
                                      anchor: anchorFor(node!),
                                      note: stepNote,
                                    },
                                  ],
                                }
                              : t,
                          ),
                        });
                        setStepNote("");
                      })
                    }
                  >
                    Add selected node as a step
                  </button>
                  {tour.steps.map((step, i) => {
                    const match = resolveAnchor(map, step.anchor);
                    return (
                      <div
                        className={
                          "work-card " + (tourStep === i ? "active" : "")
                        }
                        key={i}
                      >
                        <button
                          className="work-node"
                          disabled={!match.node}
                          onClick={() => {
                            setTourStep(i);
                            onSelect(match.node!.id);
                          }}
                        >
                          <strong>
                            {i + 1}. {step.anchor.name}
                          </strong>
                          <small>{match.status}</small>
                        </button>
                        <p>{step.note}</p>
                        <button
                          className="button subtle"
                          onClick={() =>
                            run(() =>
                              save({
                                ...data,
                                tours: data.tours.map((t) =>
                                  t.id === tour.id
                                    ? {
                                        ...t,
                                        steps: t.steps.filter(
                                          (_, at) => at !== i,
                                        ),
                                      }
                                    : t,
                                ),
                              }).then(() => {}),
                            )
                          }
                        >
                          Remove step
                        </button>
                      </div>
                    );
                  })}
                  <button
                    className="button primary"
                    disabled={!tour.steps.length}
                    onClick={() => {
                      const at = (tourStep + 1) % tour.steps.length;
                      setTourStep(at);
                      const n = resolveAnchor(map, tour.steps[at].anchor).node;
                      if (n) onSelect(n.id);
                    }}
                  >
                    Next step
                  </button>
                  <button
                    className="button subtle"
                    onClick={() =>
                      run(() =>
                        save({
                          ...data,
                          tours: data.tours.filter((t) => t.id !== tour.id),
                        }).then(() => {}),
                      )
                    }
                  >
                    Delete tour
                  </button>
                </>
              )}
            </>
          )}
        </fieldset>
      </div>
    </aside>
  );
}
