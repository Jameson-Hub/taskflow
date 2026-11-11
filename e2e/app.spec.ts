import { expect, test, type Page } from "@playwright/test";

// Every run signs up fresh people, so runs don't depend on each other or on leftover data.
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASSWORD = "e2e long password";

/** The name, email and password fields shared by sign-up and joining. */
async function fillNewAccount(page: Page, name: string, email: string) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
}

async function signUp(page: Page, workspace: string) {
  const email = `e2e-${unique()}@example.com`;
  await page.goto("/");
  await page.getByRole("tab", { name: "Create account" }).click();
  await fillNewAccount(page, "E2E Admin", email);
  await page.getByLabel("Workspace name").fill(workspace);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Your board is empty")).toBeVisible();
  return email;
}

test("the demo opens on a populated board, and the dashboard counts it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Manager/ }).click();
  // Locally the demo may have been edited since the nightly reset, so check it's there rather than exact cards.
  await expect(page.getByText("Demo workspace", { exact: true })).toBeVisible();
  await expect(page.locator(".card").first()).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();
});

test("a new account gets its own empty board, and can add a task and finish it", async ({ page }) => {
  await signUp(page, `E2E ${unique()}`);

  await page.getByRole("button", { name: "+ New task" }).click();
  await page.getByLabel("Title").fill("Write the e2e tests");
  await page.getByLabel("Add a label").fill("testing");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Create task" }).click();
  const todo = page.getByRole("region", { name: "To do" });
  await expect(todo.getByText("Write the e2e tests")).toBeVisible();
  await expect(todo.getByText("testing")).toBeVisible();

  await todo.getByText("Write the e2e tests").click();
  await page.getByLabel("Status").selectOption("done");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("region", { name: "Done" }).getByText("Write the e2e tests")).toBeVisible();
});

test("an invite link brings someone into the workspace with their own password", async ({ page, browser }) => {
  const workspace = `Invite ${unique()}`;
  await signUp(page, workspace);
  await page.getByRole("link", { name: "Team" }).click();
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.getByLabel("Invite link").inputValue();

  // Opening it while signed in asks before doing anything; staying signed in goes back to the app.
  await page.goto(link);
  await expect(page.getByText("This is an invite link, but you're signed in")).toBeVisible();
  await page.getByRole("button", { name: "Stay signed in" }).click();
  await expect(page.getByRole("link", { name: "Board", exact: true })).toBeVisible();

  // A page in a fresh browser profile: the person invited isn't signed in.
  const joiner = await browser.newPage();
  await joiner.goto(link);
  await expect(joiner.getByText(`Join ${workspace} as Member`)).toBeVisible();
  await fillNewAccount(joiner, "E2E Joiner", `joiner-${unique()}@example.com`);
  await joiner.getByRole("button", { name: "Join workspace" }).click();
  await expect(joiner.getByText(workspace)).toBeVisible();
  await expect(joiner.getByText("Member", { exact: true })).toBeVisible();
  await joiner.close();
});
