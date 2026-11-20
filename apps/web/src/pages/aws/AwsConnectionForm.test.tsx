import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { AwsConnectionForm } from "./AwsConnectionForm";

it("requires the current draft to pass Test before Save and cancels disconnect without mutating", async () => {
  const user = userEvent.setup();
  const role = "arn:aws:iam::123456789012:role/Hub";
  const check = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      accountId: "123456789012",
      arn: role,
    }),
  );
  const disconnect = vi.fn(() => Promise.resolve());
  render(
    <AwsConnectionForm
      initialRoleArn={role}
      saved
      affected="2 affected projects"
      check={check}
      disconnect={disconnect}
      changed={() => Promise.resolve()}
    />,
  );
  const save = screen.getByTestId("aws-save");
  expect(save).toBeDisabled();
  await user.click(screen.getByTestId("aws-test"));
  expect(await screen.findByTestId("aws-test-passed")).toBeVisible();
  expect(save).toBeEnabled();
  await user.type(screen.getByTestId("aws-role-arn"), "2");
  expect(save).toBeDisabled();
  await user.click(screen.getByTestId("aws-test"));
  await screen.findByTestId("aws-test-passed");
  await user.click(save);
  expect(await screen.findByTestId("aws-saved")).toBeVisible();
  expect(check.mock.lastCall).toEqual([
    `${role}2`,
    true,
    expect.any(AbortSignal),
  ]);
  const opener = screen.getByRole("button", { name: "ยกเลิกการเชื่อมต่อ" });
  await user.click(opener);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "ยกเลิก" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(opener).toHaveFocus();
  expect(disconnect).not.toHaveBeenCalled();
});

it("clears both write-only key fields after successful Save", async () => {
  const user = userEvent.setup();
  const check = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      accountId: "123456789012",
      arn: "arn:aws:iam::123456789012:user/fixture",
    }),
  );
  render(
    <AwsConnectionForm
      initialRoleArn={null}
      saved={false}
      affected=""
      check={check}
      access={{ region: "us-east-1", check }}
      disconnect={() => Promise.resolve()}
      changed={() => Promise.resolve()}
    />,
  );
  const id = screen.getByTestId("aws-accessKeyId");
  const secret = screen.getByTestId("aws-secretAccessKey");
  expect(secret).toHaveAttribute("type", "password");
  await user.type(id, "T".repeat(20));
  await user.type(secret, "x".repeat(40));
  await user.click(screen.getByTestId("aws-test"));
  await screen.findByTestId("aws-test-passed");
  await user.click(screen.getByTestId("aws-save"));
  await screen.findByTestId("aws-saved");
  expect(id).toHaveValue("");
  expect(secret).toHaveValue("");
});
