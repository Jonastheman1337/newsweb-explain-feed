import Link from "next/link";
import {
  type EditSignal,
  type EventSignal,
  type FeedbackSignal,
  type GenerationSignal,
  type SignalTab,
  SIGNAL_TABS,
  type SignalsQuery,
  type TitleSignal,
  formatDatabaseSize,
  getDatabaseSizes,
  getNumericShadowMonitorStatus,
  getSignalsData,
  type NumericShadowMonitorReadResult,
  parseSignalsQuery,
  previewJson,
  queryToSearchParams
} from "../../../../lib/admin-signals";

export const dynamic = "force-dynamic";

type SignalsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TAB_LABELS: Record<SignalTab, string> = {
  feedback: "Feedback",
  edits: "Edits",
  titles: "Titles",
  events: "Events",
  generations: "Generation runs"
};

const DATE_FORMATTER = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Oslo"
});

function formatDate(value: string | null): string {
  if (!value) return "";
  return DATE_FORMATTER.format(new Date(value));
}

function noticeLink(messageId: number | null, label?: string | null) {
  if (messageId == null) return <span className="muted">-</span>;
  return (
    <Link href={`/notice/${messageId}`} className="signalsLink">
      {label || messageId}
    </Link>
  );
}

function noticeText(row: {
  messageId: number | null;
  notice?: { issuerSign: string; issuerName: string; title: string } | null;
}) {
  if (!row.notice) return row.messageId == null ? "" : String(row.messageId);
  const issuer = row.notice.issuerSign || row.notice.issuerName;
  return issuer ? `${issuer}: ${row.notice.title}` : row.notice.title;
}

function tabHref(query: SignalsQuery, tab: SignalTab): string {
  const params = queryToSearchParams({ ...query, tab });
  return `/admin/signals?${params.toString()}`;
}

function exportHref(query: SignalsQuery): string {
  return `/api/admin/signals/export?${queryToSearchParams(query).toString()}`;
}

function EmptyState() {
  return (
    <div className="signalsEmpty">
      No rows match the current filters.
    </div>
  );
}

function TextDetails({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <details className="signalsDetails">
      <summary>{label}</summary>
      <pre>{value}</pre>
    </details>
  );
}

function modelCallsText(row: GenerationSignal): string | null {
  if (!row.modelCalls.length) return null;
  return row.modelCalls
    .map((call) => {
      const name = call.schemaName ?? "model_call";
      const reasoning = call.reasoningEffort ?? "-";
      const promptChars = call.promptChars != null ? `, ${call.promptChars} chars` : "";
      const timeout = call.timeoutMs != null ? `, timeout ${call.timeoutMs}ms` : "";
      const maxTokens =
        call.maxOutputTokens != null ? `, max ${call.maxOutputTokens} tokens` : "";
      return `${name}: ${reasoning}${promptChars}${timeout}${maxTokens}`;
    })
    .join("\n");
}

function ReferenceCheckDetails({ row }: { row: GenerationSignal }) {
  if (!row.referenceCheck) return null;
  return (
    <div className="signalsMeta">
      <div>Reference check: {row.referenceCheck.summary}</div>
      <TextDetails
        label="Reference details"
        value={previewJson(row.referenceCheck.detailJson)}
      />
    </div>
  );
}

function NumericShadowMonitorPanel({
  result
}: {
  result: NumericShadowMonitorReadResult;
}) {
  if (result.error) {
    return <div className="signalsWarning">{result.error}</div>;
  }
  if (!result.snapshot) {
    return (
      <section className="signalsMonitor">
        <div className="signalsMonitorHeader">
          <strong>Numeric shadow monitor</strong>
          <span className="signalsMonitorBadge">Awaiting first run</span>
        </div>
        <p className="muted">
          No durable monitor snapshot has been written yet. The worker writes one on startup
          and then every weekday at 18:30 Oslo time.
        </p>
      </section>
    );
  }

  const snapshot = result.snapshot;
  const stale = Date.now() - new Date(snapshot.generatedAt).getTime() > 96 * 60 * 60 * 1000;
  const needsAttention = snapshot.attention.required || stale;
  const enabledRules = snapshot.enabledRuleIds.length
    ? snapshot.enabledRuleIds.join(", ")
    : "none (shadow only)";

  return (
    <section className={needsAttention ? "signalsMonitor warning" : "signalsMonitor"}>
      <div className="signalsMonitorHeader">
        <div>
          <strong>Numeric shadow monitor</strong>
          <div className="muted">
            Last run {formatDate(snapshot.generatedAt)} · weekdays at 18:30 Oslo
          </div>
        </div>
        <span className="signalsMonitorBadge">
          {stale ? "Stale" : snapshot.attention.required ? "Review evidence" : "Quiet"}
        </span>
      </div>

      <div className="signalsMonitorStats">
        <div>
          <strong>{snapshot.query.dedupedRuns}</strong>
          <span>latest runs</span>
        </div>
        <div>
          <strong>{snapshot.query.retriesDiscarded}</strong>
          <span>retries deduped</span>
        </div>
        <div>
          <strong>{snapshot.totals.assessedOccurrences}</strong>
          <span>numbers assessed</span>
        </div>
        <div>
          <strong>{snapshot.totals.unexpectedOccurrences}</strong>
          <span>unexpected numbers</span>
        </div>
        <div>
          <strong>{snapshot.totals.shadowCandidateOccurrences}</strong>
          <span>shadow occurrences</span>
        </div>
      </div>

      <p className="muted signalsMonitorMeta">
        Oslo window {snapshot.window.fromDate}–{snapshot.window.throughDate} · enabled rules: {enabledRules}
        {snapshot.attention.newCandidateAssessmentRecords > 0
          ? ` · ${snapshot.attention.newCandidateAssessmentRecords} new candidate record(s) since the previous run`
          : ""}
      </p>

      {stale ? (
        <div className="signalsMonitorReason">
          No successful snapshot has been recorded for more than 96 hours.
        </div>
      ) : null}
      {snapshot.attention.reasons.map((reason) => (
        <div className="signalsMonitorReason" key={reason}>
          {reason}
        </div>
      ))}

      <div className="signalsMonitorRules">
        {snapshot.rules.map((rule) => (
          <div className="signalsMonitorRule" key={rule.ruleId}>
            <div>
              <strong className="signalsMono">{rule.ruleId}</strong>{" "}
              <span className="muted">{rule.enabled ? "enabled" : "shadow"}</span>
            </div>
            <div>
              {rule.candidateOccurrences} candidate occurrence(s) in {rule.candidateNotices}{" "}
              notice(s); {rule.numericWouldClearRuns}/{rule.candidateRuns} latest candidate run(s)
              would clear the numeric unexpected-number blocker. {rule.derivedOccurrences} accepted
              derivation occurrence(s).
            </div>
            {rule.examples.length > 0 ? (
              <div className="signalsMonitorExamples">
                Examples:{" "}
                {rule.examples.slice(0, 5).map((example, index) => (
                  <span key={`${example.messageId}:${example.version ?? "null"}`}>
                    {index > 0 ? ", " : ""}
                    {noticeLink(
                      example.messageId,
                      `${example.messageId}${example.version == null ? "" : ` v${example.version}`} (${example.candidateDisplays.join(", ")})`
                    )}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function FeedbackTable({ rows }: { rows: FeedbackSignal[] }) {
  if (!rows.length) return <EmptyState />;
  return (
    <table className="signalsTable">
      <thead>
        <tr>
          <th>Time</th>
          <th>Notice</th>
          <th>Version</th>
          <th>Feedback</th>
          <th>Event</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{formatDate(row.createdAt)}</td>
            <td>{noticeLink(row.messageId, noticeText(row))}</td>
            <td>{row.version ?? "-"}</td>
            <td className="signalsText">{row.text}</td>
            <td className="signalsMono">{row.eventId ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EditsTable({ rows }: { rows: EditSignal[] }) {
  if (!rows.length) return <EmptyState />;
  return (
    <table className="signalsTable">
      <thead>
        <tr>
          <th>Time</th>
          <th>Notice</th>
          <th>Changed</th>
          <th>Title</th>
          <th>Body</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{formatDate(row.copiedAt)}</td>
            <td>{noticeLink(row.messageId, noticeText(row))}</td>
            <td>{row.hasEdits ? "Yes" : "No"}</td>
            <td className="signalsText">
              <div>{row.editedTitle}</div>
              {row.originalTitle !== row.editedTitle ? (
                <TextDetails label="Original title" value={row.originalTitle} />
              ) : null}
            </td>
            <td>
              <TextDetails label="Edited body" value={row.editedBody} />
              {row.originalBody !== row.editedBody ? (
                <TextDetails label="Original body" value={row.originalBody} />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TitlesTable({ rows }: { rows: TitleSignal[] }) {
  if (!rows.length) return <EmptyState />;
  return (
    <table className="signalsTable">
      <thead>
        <tr>
          <th>Time</th>
          <th>Notice</th>
          <th>Action</th>
          <th>Selected</th>
          <th>Suggestions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{formatDate(row.createdAt)}</td>
            <td>{noticeLink(row.messageId, noticeText(row))}</td>
            <td className="signalsMono">{row.action ?? "-"}</td>
            <td className="signalsText">
              {row.selectedTitle ?? "-"}
              {row.selectedWasOriginal ? <div className="muted">Original title selected</div> : null}
              {row.selectedIndex != null ? <div className="muted">Index {row.selectedIndex}</div> : null}
            </td>
            <td>
              <TextDetails label={`${row.suggestions.length} suggestions`} value={row.suggestions.join("\n")} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EventsTable({ rows }: { rows: EventSignal[] }) {
  if (!rows.length) return <EmptyState />;
  return (
    <table className="signalsTable">
      <thead>
        <tr>
          <th>Time</th>
          <th>Notice</th>
          <th>Action</th>
          <th>Source</th>
          <th>Context</th>
          <th>Payload</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.sourceDb}-${row.id}`}>
            <td>{formatDate(row.createdAt)}</td>
            <td>{noticeLink(row.messageId, noticeText(row))}</td>
            <td className="signalsMono">{row.action}</td>
            <td>
              <span className="signalsBadge">{row.sourceDb}</span>
              <div className="muted">{row.actionSource ?? "-"}</div>
            </td>
            <td className="signalsMeta">
              <div>Version: {row.version ?? "-"}</div>
              <div>Prompt: {row.promptVersion ?? "-"}</div>
              <div>Model: {row.model ?? "-"}</div>
              <div>Editor hash: {row.hasEditorIdHash ? "yes" : "no"}</div>
              <div>Session hash: {row.hasSessionIdHash ? "yes" : "no"}</div>
            </td>
            <td>
              <TextDetails label="Payload" value={previewJson(row.payloadJson)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GenerationsTable({ rows }: { rows: GenerationSignal[] }) {
  if (!rows.length) return <EmptyState />;
  return (
    <table className="signalsTable">
      <thead>
        <tr>
          <th>Requested</th>
          <th>Notice</th>
          <th>Reason</th>
          <th>Status</th>
          <th>Model</th>
          <th>Instruction / Error</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.sourceDb}-${row.id}`}>
            <td>
              {formatDate(row.requestedAt)}
              <div className="muted">{row.sourceDb}</div>
            </td>
            <td>
              {noticeLink(row.messageId, noticeText(row))}
              <div className="muted">Version {row.version ?? "-"}</div>
            </td>
            <td className="signalsMono">{row.reason}</td>
            <td>
              <span className="signalsBadge">{row.status}</span>
              <div className="muted">{row.jobName ?? row.jobId ?? ""}</div>
              {row.errorGroup ? (
                <div className="muted">
                  Group: {row.errorGroup} ({row.errorGroupCount})
                </div>
              ) : null}
            </td>
            <td className="signalsMeta">
              <div>{row.model ?? "-"}</div>
              <div>{row.promptVersion ?? "-"}</div>
              <div>{row.promptChars ?? "-"} chars</div>
              {row.reasoningEffortOverride ? (
                <div>Override: {row.reasoningEffortOverride}</div>
              ) : null}
              <TextDetails label="Model calls" value={modelCallsText(row)} />
            </td>
            <td>
              <TextDetails label="User instruction" value={row.userInstruction} />
              <ReferenceCheckDetails row={row} />
              <TextDetails label="Validation" value={previewJson(row.validationJson)} />
              <TextDetails label="Error" value={row.errorText} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function SignalsPage({ searchParams }: SignalsPageProps) {
  const params = await searchParams;
  const query = parseSignalsQuery(params);
  const [result, dbSizes, numericShadowMonitor] = await Promise.all([
    getSignalsData(query),
    getDatabaseSizes().catch(() => null),
    getNumericShadowMonitorStatus().catch(
      (): NumericShadowMonitorReadResult => ({
        snapshot: null,
        error: "Numeric shadow monitor status could not be read."
      })
    )
  ]);
  const rowCount = result.data.rows.length;

  return (
    <section className="signalsPage">
      <div className="signalsHeader">
        <div>
          <h2>Signals</h2>
          <p className="muted">
            Read-only view of feedback, edits, title activity, action events, and generation runs.
          </p>
          {dbSizes ? (
            <p className="muted">
              DB {formatDatabaseSize(dbSizes.primaryBytes)}
              {dbSizes.logBytes != null
                ? ` · Log DB ${formatDatabaseSize(dbSizes.logBytes)}`
                : ""}
            </p>
          ) : null}
        </div>
        <Link className="ghostButton" href={exportHref(query)}>
          Export CSV
        </Link>
      </div>

      <div className="signalsNotice">
        <strong>Log DB:</strong>{" "}
        {result.logDbMode === "dedicated"
          ? "Dedicated log database configured. Events and generation runs are read from both the log DB and legacy primary rows."
          : "Dedicated log database is not configured. Events and generation runs are currently stored in the primary app database."}
      </div>

      <NumericShadowMonitorPanel result={numericShadowMonitor} />

      {result.warnings.map((warning) => (
        <div className="signalsWarning" key={warning}>
          {warning}
        </div>
      ))}

      <nav className="signalsTabs" aria-label="Signal tabs">
        {SIGNAL_TABS.map((tab) => (
          <Link
            key={tab}
            href={tabHref(query, tab)}
            className={tab === query.tab ? "signalsTab active" : "signalsTab"}
          >
            {TAB_LABELS[tab]}
          </Link>
        ))}
      </nav>

      <form className="signalsFilters" method="get">
        <input type="hidden" name="tab" value={query.tab} />
        <label>
          <span>Message ID</span>
          <input name="messageId" inputMode="numeric" defaultValue={query.messageId ?? ""} />
        </label>
        <label>
          <span>Action / status</span>
          <input
            name="action"
            placeholder="feedback_submit, success..."
            defaultValue={query.action ?? ""}
          />
        </label>
        <label>
          <span>From</span>
          <input name="from" type="date" defaultValue={query.from ?? ""} />
        </label>
        <label>
          <span>To</span>
          <input name="to" type="date" defaultValue={query.to ?? ""} />
        </label>
        <label>
          <span>Limit</span>
          <select name="limit" defaultValue={String(query.limit)}>
            {[50, 100, 250, 500].map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>

      <div className="signalsCount">
        Showing {rowCount} {rowCount === 1 ? "row" : "rows"}
      </div>

      <div className="signalsTableWrap">
        {result.data.tab === "feedback" ? <FeedbackTable rows={result.data.rows} /> : null}
        {result.data.tab === "edits" ? <EditsTable rows={result.data.rows} /> : null}
        {result.data.tab === "titles" ? <TitlesTable rows={result.data.rows} /> : null}
        {result.data.tab === "events" ? <EventsTable rows={result.data.rows} /> : null}
        {result.data.tab === "generations" ? <GenerationsTable rows={result.data.rows} /> : null}
      </div>
    </section>
  );
}
