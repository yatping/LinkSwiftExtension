import type { MenuCommand, TabMessage } from '@/utils/protocol';

const list = document.querySelector<HTMLUListElement>('#commands')!;
const empty = document.querySelector<HTMLParagraphElement>('#empty')!;

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let commands: MenuCommand[] = [];
  if (tab?.id !== undefined) {
    try {
      commands = (await chrome.tabs.sendMessage(tab.id, { type: 'menu:list' } satisfies TabMessage)) ?? [];
    } catch {
      // No LinkSwift content script on this tab.
    }
  }

  empty.hidden = commands.length > 0;
  for (const command of commands) {
    const button = document.createElement('button');
    button.textContent = command.caption;
    button.addEventListener('click', async () => {
      await chrome.tabs.sendMessage(tab!.id!, { type: 'menu:invoke', id: command.id } satisfies TabMessage);
      window.close();
    });
    const item = document.createElement('li');
    item.append(button);
    list.append(item);
  }
}

render();
