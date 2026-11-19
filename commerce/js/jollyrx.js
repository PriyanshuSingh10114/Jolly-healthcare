(() => {
  const root = document.querySelector('[data-jollyrx]');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true';
  const api = root.dataset.api;
  const grid = root.querySelector('[data-catalog]');
  const catalogStatus = root.querySelector('[data-catalog-status]');
  const dialog = root.querySelector('dialog');
  const form = root.querySelector('[data-rfq]');
  const status = root.querySelector('[data-rfq-status]');
  const send = form.querySelector('[type=submit]');
  const close = form.querySelector('[data-close]');

  function element(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  async function load() {
    try {
      const response = await fetch(api + '/catalog', { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error();
      const { items } = await response.json();
      for (const item of items) {
        const card = element('article', '');
        card.className = 'jrx-card';
        const details = document.createElement('dl');
        for (const [label, value] of [
          ['Dosage form', item.dosage], ['Certification', item.certification],
          ['MOQ', Intl.NumberFormat('en-IN').format(item.moq)],
        ]) details.append(element('dt', label), element('dd', value));
        const button = element('button', 'Request quote');
        button.type = 'button';
        button.className = 'jrx-button';
        button.setAttribute('aria-label', 'Request quote for ' + item.node);
        button.addEventListener('click', () => {
          form.reset();
          form.elements.node.value = item.node;
          send.disabled = false;
          status.textContent = '';
          dialog.showModal();
          form.elements.name.focus();
        });
        card.append(element('h3', item.node), details, button);
        grid.append(card);
      }
      catalogStatus.textContent = items.length ? '' : 'No formulations are currently available.';
    } catch {
      catalogStatus.textContent = 'Catalog unavailable. Refresh the page to try again.';
    }
  }

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    if (form.getAttribute('aria-busy') === 'true') event.preventDefault();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (send.disabled) return;
    send.disabled = true;
    close.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'Sending your request…';
    const data = Object.fromEntries(new FormData(form));
    data.quantity = Number(data.quantity);
    let confirmed = false;
    try {
      const response = await fetch(api + '/rfq', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: AbortSignal.timeout(55000),
      });
      const result = await response.json();
      if (response.ok && result.ok === true) {
        confirmed = true;
        form.reset();
        status.textContent = 'Request received. The JollyRx team will follow up by email.';
      } else {
        status.textContent = result.error || 'Request could not be confirmed. Please try again.';
      }
    } catch {
      status.textContent = 'Request could not be confirmed. Please try again.';
    } finally {
      form.removeAttribute('aria-busy');
      send.disabled = confirmed;
      close.disabled = false;
    }
  });

  load();
})();
