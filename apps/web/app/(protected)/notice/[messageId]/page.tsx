import Link from "next/link";
import { redirect } from "next/navigation";
import { getNotice } from "../../../../lib/api";
import { GenerateButton } from "../../../../components/generate-button";
import { EditableRewrite } from "../../../../components/editable-rewrite";
import { ProcessingIndicator } from "../../../../components/processing-indicator";
import { RewriteTabs } from "../../../../components/rewrite-tabs";
import { InstructionInput } from "../../../../components/instruction-input";
import { SourceBodyText } from "../../../../components/source-body-text";
import { getSessionToken } from "../../../../lib/session";

type NoticePageProps = {
  params: Promise<{ messageId: string }>;
};

function formatOsloTime(isoString: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Oslo"
  }).format(new Date(isoString));
}

export default async function NoticePage({ params }: NoticePageProps) {
  const token = await getSessionToken();
  if (!token) {
    redirect("/login");
  }

  const { messageId } = await params;
  const id = Number(messageId);
  if (Number.isNaN(id)) {
    redirect("/feed");
  }

  const notice = await getNotice(token, id).catch(() => {
    redirect("/feed");
  });

  const isProcessing = "processing" in notice && notice.processing === true;
  const isSkipped = "skipped" in notice && notice.skipped === true;
  const isFailed = "failed" in notice && notice.failed === true;

  const dateline = (
    <p key="dateline" className="muted">
      <a href={`https://newsweb.oslobors.no/message/${notice.source.messageId}`} target="_blank" rel="noopener noreferrer">
        {notice.source.issuerName} ({notice.source.issuerSign}) |{" "}
        {formatOsloTime(notice.source.publishedAt)}
      </a>
    </p>
  );

  return (
    <section>
      <Link href="/feed" className="muted" title="Tilbake til feed">
        ←
      </Link>
      <div className="noticeGrid">
      <article className="noticeContent">
        {isProcessing ? (
          <>
            <p className="noticePanelTitle">AI-notis genereres</p>
            <h2>{notice.source.title}</h2>
            {dateline}
            <ProcessingIndicator messageId={notice.source.messageId} hasAttachments={notice.source.hasAttachments} />
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
            <GenerateButton messageId={notice.source.messageId} hasAttachments={notice.source.hasAttachments} />
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
                  <RewriteTabs
                    rewrites={rewrites}
                    messageId={notice.source.messageId}
                    dateline={dateline}
                    hasAttachments={notice.source.hasAttachments}
                  />
                ) : (
                  <>
                    <EditableRewrite
                      messageId={notice.source.messageId}
                      originalTitle={rewrite.title}
                      originalBody={[rewrite.lead, ...rewrite.body].filter(Boolean).join("\n\n")}
                      dateline={dateline}
                      panelTitle="AI-generert notis"
                    />
                    <InstructionInput
                      messageId={notice.source.messageId}
                      activeVersion={rewrites?.[0]?.version}
                      hasAttachments={notice.source.hasAttachments}
                    />
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
          <a href={`https://newsweb.oslobors.no/message/${notice.source.messageId}`} target="_blank" rel="noopener noreferrer">
            {notice.source.issuerName} ({notice.source.issuerSign}) |{" "}
            {formatOsloTime(notice.source.publishedAt)}
          </a>
        </p>
        <SourceBodyText text={notice.source.bodyText} />
        <a
          href={`https://newsweb.oslobors.no/message/${notice.source.messageId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="muted"
        >
          Se børsmeldingen på Newsweb
        </a>
      </article>
      </div>
    </section>
  );
}
