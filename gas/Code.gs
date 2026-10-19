function doPost(e) {
  try {
    const expected = String(
      PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET") || "",
    ).trim();
    const data = JSON.parse((e.postData && e.postData.contents) || "{}");
    const got = String(data.secret || "").trim();
    if (!expected || !got || got !== expected) {
      return json_({ ok: false, error: "unauthorized" });
    }
    if (data.action === "ping") {
      return json_({ ok: true, ping: true });
    }
    if (!data.to || !data.subject || data.body == null) {
      return json_({ ok: false, error: "missing to, subject, or body" });
    }
    const options = {};
    if (data.replyTo) options.replyTo = String(data.replyTo);
    if (data.name) options.name = String(data.name);
    GmailApp.sendEmail(String(data.to), String(data.subject), String(data.body), options);
    return json_({ ok: true, sent: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, service: "github-outreach-mailer" });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
