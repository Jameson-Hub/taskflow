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
  await page.getByLabel("Add a checklist item").fill("Cover checklists");
  await page.keyboard.press("Enter");
  await page.getByLabel("Add a checklist item").fill("Run them in CI");
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: "Cover checklists" }).check();
  await page.getByLabel("Status").selectOption("done");
  await page.getByRole("button", { name: "Save changes" }).click();
  const done = page.getByRole("region", { name: "Done" });
  await expect(done.getByText("Write the e2e tests")).toBeVisible();
  await expect(done.getByText("☑ 1/2")).toBeVisible();
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

test("the board works from the keyboard: shortcuts, and moving a card without a mouse", async ({ page }) => {
  await signUp(page, `Keys ${unique()}`);

  await page.keyboard.press("n");
  await page.getByLabel("Title").fill("Move me with the keyboard");
  await page.getByRole("button", { name: "Create task" }).click();
  const card = page.getByRole("button", { name: /Move me with the keyboard/ });
  await expect(page.getByRole("region", { name: "To do" }).getByText("Move me with the keyboard")).toBeVisible();

  await card.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByRole("region", { name: "In progress" }).getByText("Move me with the keyboard")).toBeVisible();
  await expect(card).toBeFocused();
  await expect(page.getByText(/Moved "Move me with the keyboard" to In progress/)).toBeAttached();

  await page.locator(":focus").blur();
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search tasks")).toBeFocused();
});

test("a deleted task can be undone for a few seconds, then it's gone for good", async ({ page }) => {
  await page.clock.install();
  await signUp(page, `Undo ${unique()}`);
  const todo = page.getByRole("region", { name: "To do" });
  const add = async (title: string) => {
    await page.getByRole("button", { name: "+ New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(todo.getByText(title)).toBeVisible();
  };
  const remove = async (title: string) => {
    await todo.getByText(title).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(todo.getByText(title)).toHaveCount(0);
  };

  const undo = page.getByRole("status").getByRole("button", { name: "Undo" });

  await add("Changed my mind");
  await remove("Changed my mind");
  await undo.click();
  await expect(todo.getByText("Changed my mind")).toBeVisible();
  // Undone means kept: nothing is sent when the window would have run out.
  await page.clock.fastForward(11_000);
  await page.reload();
  await expect(todo.getByText("Changed my mind")).toBeVisible();

  await remove("Changed my mind");
  const deleted = page.waitForResponse((r) => r.request().method() === "DELETE");
  await page.clock.fastForward(11_000);
  await deleted;
  await expect(undo).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Your board is empty")).toBeVisible();
});

test("@mentions suggest teammates, are highlighted, and drive the 'Mentions me' filter", async ({ page }) => {
  await signUp(page, `Mentions ${unique()}`);
  for (const title of ["Needs a look", "Nobody mentioned here"]) {
    await page.getByRole("button", { name: "+ New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
  }

  await page.getByRole("region", { name: "To do" }).getByText("Needs a look").click();
  const box = page.getByLabel("Write a comment");
  await box.fill("Can you check this @E2E");
  await expect(page.getByRole("listbox", { name: "Mention someone" }).getByRole("option", { name: "E2E Admin" })).toBeVisible();
  await box.press("Enter"); // picks the suggestion instead of sending
  await expect(box).toHaveValue("Can you check this @E2E Admin ");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("mark.mention", { hasText: "@E2E Admin" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("Mentions me").check();
  await expect(page.getByText("Needs a look")).toBeVisible();
  await expect(page.getByText("Nobody mentioned here")).toHaveCount(0);
});

test("it can be installed, and fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
  const res = await page.request.get(manifest!);
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ name: "TaskFlow", display: "standalone" });

  await page.getByRole("button", { name: /Manager/ }).click();
  await expect(page.locator(".card").first()).toBeVisible();
  for (const tab of ["Board", "Dashboard", "Activity"]) {
    await page.getByRole("link", { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // The smallest phones, signed in as an admin with more tabs: every tab is on screen, none hidden off the edge.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: /Admin/ }).click();
  for (const tab of ["Board", "Dashboard", "Activity", "Team"]) {
    await expect(page.getByRole("link", { name: tab, exact: true })).toBeInViewport({ ratio: 1 });
  }
});
