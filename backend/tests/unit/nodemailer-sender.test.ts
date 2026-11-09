import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailSender, NodemailerSender, type EmailSender } from "../../src/modules/notifications/email-sender.js";

// The real transport is replaced by a double: no test needs an SMTP server (Principle II).
const mocks = vi.hoisted(() => {
  const sendMail = vi.fn();
  const verify = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail, verify }));
  return { sendMail, verify, createTransport };
});
vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));

const settings = { url: "smtps://user:pw@mail.test:465", from: "La Mesa <noreply@resto.test>", timeoutMs: 1234 };
const message = { to: "jane@example.test", subject: "Subject", text: "Body" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendMail.mockResolvedValue({});
});

describe("NodemailerSender (T014, research R1)", () => {
  it("creates the transport once, in object form, with all three timeouts equal to EMAIL_TIMEOUT_MS", () => {
    new NodemailerSender(settings);
    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
    expect(mocks.createTransport).toHaveBeenCalledWith({
      url: settings.url,
      connectionTimeout: 1234,
      greetingTimeout: 1234,
      socketTimeout: 1234,
    });
  });

  it("never calls verify(), so an unreachable server cannot block startup", async () => {
    const sender = new NodemailerSender(settings);
    await sender.send(message);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("maps send() to sendMail with from, to, subject and text, and nothing else", async () => {
    const sender: EmailSender = new NodemailerSender(settings);
    await sender.send(message, { kind: "confirmation", reservationId: "abc" });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  });

  it("reuses one transport for several sends", async () => {
    const sender = new NodemailerSender(settings);
    await sender.send(message);
    await sender.send(message);
    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
  });

  it("propagates a rejection to the caller (the notifier logs it)", async () => {
    mocks.sendMail.mockRejectedValue(Object.assign(new Error("boom"), { code: "ESOCKET" }));
    const sender = new NodemailerSender(settings);
    await expect(sender.send(message)).rejects.toMatchObject({ code: "ESOCKET" });
  });

  it("createEmailSender passes SMTP_URL, EMAIL_FROM and EMAIL_TIMEOUT_MS through", () => {
    createEmailSender({ SMTP_URL: settings.url, EMAIL_FROM: settings.from, EMAIL_TIMEOUT_MS: 777 });
    expect(mocks.createTransport).toHaveBeenCalledWith({
      url: settings.url,
      connectionTimeout: 777,
      greetingTimeout: 777,
      socketTimeout: 777,
    });
  });

  it("createEmailSender builds no transport when SMTP_URL is absent", () => {
    createEmailSender({ EMAIL_TIMEOUT_MS: 777 });
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
});
