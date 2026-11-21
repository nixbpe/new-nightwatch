// The mailer lives in packages/shared so the Worker sends mail with the same code.
export {
  createMailer,
  senderAddress,
  type Mailer,
  type OutboundMail,
} from "@nightwatch/shared";
