import Link from "next/link";
import { redirect } from "next/navigation";
import { getNotice, getNoticeStatus, isApiAuthError } from "../../../../lib/api";
import { GenerateButton } from "../../../../components/generate-button";
import { EditableRewrite } from "../../../../components/editable-rewrite";
import { ProcessingIndicator } from "../../../../components/processing-indicator";
import { NoticeRefreshListener } from "../../../../components/notice-refresh-listener";
import { RewriteTabs } from "../../../../components/rewrite-tabs";
import { InstructionInput } from "../../../../components/instruction-input";
import { SourceBodyText } from "../../../../components/source-body-text";
import {
  NoticeTelemetry,
  SourceLink
} from "../../../../components/notice-telemetry";
import { AttachmentLinks } from "../../../../components/attachment-links";
import { getSessionToken } from "../../../../lib/session";

type NoticePageProps = {
  params: Promise<{ messageId: string }>;
  searchParams: Promise<{ from?: string }>;
};

function formatOsloTime(isoString: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Oslo"
  }).format(new Date(isoString));
}

function getReturnHref(from?: string): string {
  if (!from) return "/feed";
  if (from === "/feed" || from.startsWith("/feed?")) return from;
  return "/feed";
}

export default async function NoticePage({ params, searchParams }: NoticePageProps) {
  const token = await getSessionToken();
  if (!token) {
    redirect("/login");
  }

  const { messageId } = await params;
  const { from } = await searchParams;
  const returnHref = getReturnHref(from);
  const id = Number(messageId);
  if (Number.isNaN(id)) {
    redirect("/feed");
  }

  const notice = await getNotice(token, id).catch((error) => {
    if (isApiAuthError(error)) {
      redirect("/login");
    }
    redirect("/feed");
  });
  const noticeStatus = await getNoticeStatus(token, id).catch((error) => {
    if (isApiAuthError(error)) {
      redirect("/login");
    }
    return null;
  });

  const isProcessing = "processing" in notice && notice.processing === true;
  const isSkipped = "skipped" in notice && notice.skipped === true;
  const isFailed = "failed" in notice && notice.failed === true;
  const isRegenerating =
    !isProcessing &&
    !isSkipped &&
    !isFailed &&
    noticeStatus != null &&
    !noticeStatus.ready &&
    !noticeStatus.failed;
  const activeVersion =
    "rewrites" in notice && notice.rewrites?.length
      ? notice.rewrites[notice.rewrites.length - 1]?.version
      : undefined;
  const sourceUrl = `https://newsweb.oslobors.no/message/${notice.source.messageId}`;
  const telemetryState = isProcessing
    ? "processing"
    : isSkipped
      ? "skipped"
      : isFailed
        ? "failed"
        : "published";

  const dateline = (
    <p key="dateline" className="muted">
      <SourceLink
        messageId={notice.source.messageId}
        activeVersion={activeVersion}
        href={sourceUrl}
      >
        {notice.source.issuerName} ({notice.source.issuerSign}) |{" "}
        {formatOsloTime(notice.source.publishedAt)}
      </SourceLink>
    </p>
  );

  const regenerationIndicator = isRegenerating ? (
    <div className="regenerationStatus">
      <p className="noticePanelTitle">Ny AI-versjon genereres</p>
      <ProcessingIndicator
        messageId={notice.source.messageId}
        hasAttachments={notice.source.hasAttachments}
        initialPhase={noticeStatus?.phase}
      />
    </div>
  ) : null;

  return (
    <section>
      <NoticeTelemetry
        messageId={notice.source.messageId}
        activeVersion={activeVersion}
        state={telemetryState}
      />
      <NoticeRefreshListener messageId={notice.source.messageId} />
      <Link href={returnHref} className="muted" title="Tilbake til feed">
        ←
      </Link>
      <div className="noticeGrid">
      <article className="noticeContent">
        {isProcessing ? (
          <>
            <p className="noticePanelTitle">AI-notis genereres</p>
            <h2>{notice.source.title}</h2>
            {dateline}
            <ProcessingIndicator
              messageId={notice.source.messageId}
              hasAttachments={notice.source.hasAttachments}
              initialPhase={noticeStatus?.phase}
            />
          </>
        ) : isSkipped ? (
          <>
            <p className="noticePanelTitle">Ikke generert enda</p>
            <h2>{notice.source.title}</h2>
            {dateline}
            <p>Denne børsmeldingen har ikke blitt omskrevet enda.</p>
            <GenerateButton messageId={notice.source.messageId} hasAttachments={notice.source.hasAttachments} />
          </>
        ) : isFailed ? (
          <>
            <p className="noticePanelTitle">Generering feilet</p>
            <h2>{notice.source.title}</h2>
            {dateline}
            <p>AI-notisen kunne ikke genereres automatisk.</p>
            <GenerateButton messageId={notice.source.messageId} label="Prøv igjen" hasAttachments={notice.source.hasAttachments} />
            <GenerateButton
              messageId={notice.source.messageId}
              label="Prøv xhigh"
              hasAttachments={notice.source.hasAttachments}
              reasoningEffortOverride="xhigh"
            />
          </>
        ) : (
          (() => {
            const rewrite = ("rewrite" in notice) ? notice.rewrite : null;
            const rewrites = ("rewrites" in notice && notice.rewrites?.length)
              ? notice.rewrites
              : null;

            if (!rewrite) return null;

            return (
              <>
                {rewrites && rewrites.length > 1 ? (
                  <>
                    <RewriteTabs
                      rewrites={rewrites}
                      messageId={notice.source.messageId}
                      dateline={dateline}
                      hasAttachments={notice.source.hasAttachments}
                    />
                    {regenerationIndicator}
                  </>
                ) : (
                  <>
                    <EditableRewrite
                      messageId={notice.source.messageId}
                      originalTitle={rewrite.title}
                      originalBody={[rewrite.lead, ...rewrite.body].filter(Boolean).join("\n\n")}
                      activeVersion={activeVersion}
                      dateline={dateline}
                      panelTitle="AI-generert notis"
                    />
                    <InstructionInput
                      messageId={notice.source.messageId}
                      activeVersion={activeVersion}
                      hasAttachments={notice.source.hasAttachments}
                    />
                    {regenerationIndicator}
                  </>
                )}
              </>
            );
          })()
        )}
      </article>

      <article className="sourcePanel">
        <p className="noticePanelTitle">Original børsmelding</p>
        <h2>{notice.source.title}</h2>
        <p className="muted">
          <SourceLink
            messageId={notice.source.messageId}
            activeVersion={activeVersion}
            href={sourceUrl}
          >
            {notice.source.issuerName} ({notice.source.issuerSign}) |{" "}
            {formatOsloTime(notice.source.publishedAt)}
          </SourceLink>
        </p>
        <SourceBodyText text={notice.source.bodyText} />
        <AttachmentLinks
          messageId={notice.source.messageId}
          attachments={notice.source.attachments}
        />
        <SourceLink
          messageId={notice.source.messageId}
          activeVersion={activeVersion}
          href={sourceUrl}
          className="muted"
        >
          Se børsmeldingen på Newsweb
        </SourceLink>
      </article>
      </div>
    </section>
  );
}
