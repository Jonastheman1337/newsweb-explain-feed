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
  getSignalsData,
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
            </td>
            <td className="signalsMeta">
              <div>{row.model ?? "-"}</div>
              <div>{row.promptVersion ?? "-"}</div>
              <div>{row.promptChars ?? "-"} chars</div>
            </td>
            <td>
              <TextDetails label="User instruction" value={row.userInstruction} />
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
  const result = await getSignalsData(query);
  const rowCount = result.data.rows.length;

  return (
    <section className="signalsPage">
      <div className="signalsHeader">
        <div>
          <h2>Signals</h2>
          <p className="muted">
            Read-only view of feedback, edits, title activity, action events, and generation runs.
          </p>
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
