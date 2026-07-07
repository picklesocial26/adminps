// app.js — extracted from index.html
// Global variables
let selectedSlots = new Set();
let supabaseClient = null;
let pendingBookingEntries = [];
let pendingSlotsWithTimer = {}; // Track pending slots with timestamps
let receiptFile = null;
let receiptBookingReference = '';
let receiptBookingTotal = 0;
let receiptRefUploaded = false;
const TEST_MODE_FORCE_ONE_PHP = true; // Force all booking totals to ₱1 for test purposes

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) {
    console.warn('Toast element not found:', message);
    return;
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function updateSuccessReceiptUploadState() {
  const uploadButton = document.getElementById('successUploadReceiptBtn');
  const statusNote = document.getElementById('receiptUploadedStatus');
  if (!uploadButton || !statusNote) return;
  if (receiptRefUploaded) {
    uploadButton.disabled = true;
    uploadButton.classList.add('disabled');
    statusNote.style.display = 'block';
  } else {
    uploadButton.disabled = false;
    uploadButton.classList.remove('disabled');
    statusNote.style.display = 'none';
  }
}

async function uploadReceiptImage(file, reference) {
  if (!supabaseClient || !file) return null;

  const extension = file.name.split('.').pop().toLowerCase() || 'jpg';
  const safeReference = reference.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = `receipts/${safeReference}_${Date.now()}.${extension}`;

  const { data, error } = await supabaseClient.storage
    .from('receipts')
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (error) {
    console.error('Receipt upload failed', error);
    const message = error?.message || 'Receipt upload failed. Check your Supabase storage policy.';
    showToast(message);
    return null;
  }

  const { data: publicData, error: publicError } = await supabaseClient.storage
    .from('receipts')
    .getPublicUrl(filePath);

  if (publicError) {
    console.error('Could not get public URL for receipt', publicError);
    showToast('Could not get receipt URL after upload.');
    return null;
  }

  return publicData?.publicUrl || null;
}

document.addEventListener("DOMContentLoaded", async () => {
  // Remove direct Supabase client - now using backend API
  // Supabase keys are stored in backend environment variables for security

  const dot = document.getElementById("statusDot");
  const label = document.getElementById("statusLabel");

  // Helper function to call backend API or direct Supabase client for local dev
  async function callBackendAPI(action, data = {}) {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';

    // If a direct Supabase fallback is configured and we're running locally, use it
    if ((window.SUPABASE_FALLBACK && isLocal) || supabaseClient) {
      if (!supabaseClient) {
        const url = (window.SUPABASE_FALLBACK && window.SUPABASE_FALLBACK.url) || null;
        const key = (window.SUPABASE_FALLBACK && window.SUPABASE_FALLBACK.key) || null;
        if (!url || !key) {
          throw new Error('Supabase fallback not configured for direct client');
        }
        supabaseClient = supabase.createClient(url, key);
      }

      try {
        if (action === 'check-connection') {
          const { error } = await supabaseClient.from('bookings').select('id').limit(1);
          if (error) throw error;
          return { status: 'connected' };
        }

        if (action === 'get-booked-slots') {
          const { bookingDate } = data;
          // Include status and receipt_reference so frontend can distinguish pending vs confirmed
          const { data: rows, error } = await supabaseClient
            .from('bookings')
            .select('time_slot,court,customer_name,status,receipt_reference,created_at')
            .eq('booking_date', bookingDate);
          if (error) throw error;
          return { bookings: rows || [] };
        }

        if (action === 'create-booking') {
          const { bookingDate, timeSlot, court, customer_name, phone_number } = data;
          const { data: inserted, error } = await supabaseClient
            .from('bookings')
            .insert([{
              booking_date: bookingDate,
              time_slot: timeSlot,
              court,
              customer_name,
              phone_number,
              created_at: new Date().toISOString()
            }])
            .select();
          if (error) throw error;
          return { success: true, booking: inserted?.[0] || null };
        }

        if (action === 'bulk-insert-bookings') {
          const { bookings } = data;
          const { data: inserted, error } = await supabaseClient.from('bookings').insert(bookings).select();
          if (error) throw error;
          return { success: true, count: inserted?.length || 0, bookings: inserted || [] };
        }

        if (action === 'get-booking-by-reference') {
          const { reference } = data;
          const { data: rows, error } = await supabaseClient.from('bookings').select('*').eq('reference_code', reference);
          if (error) throw error;
          return { bookings: rows || [] };
        }

        if (action === 'check-duplicate-receipt') {
          const { receipt_reference } = data;
          const { data: rows, error } = await supabaseClient.from('bookings').select('id').eq('receipt_reference', receipt_reference).limit(1);
          if (error) throw error;
          return { exists: rows && rows.length > 0, bookings: rows || [] };
        }

        if (action === 'update-booking-receipt') {
          const { reference_code, receipt_reference, status } = data;
          const { data: updated, error } = await supabaseClient
            .from('bookings')
            .update({ receipt_reference, status })
            .eq('reference_code', reference_code)
            .select();
          if (error) throw error;
          return { success: true, updated: updated?.length || 0, bookings: updated || [] };
        }

        if (action === 'confirm-booking') {
          const { booking_id, reference_code } = data;
          let query = supabaseClient.from('bookings').update({ status: 'confirmed' });
          
          if (booking_id) {
            query = query.eq('id', booking_id);
          } else if (reference_code) {
            query = query.eq('reference_code', reference_code);
          } else {
            throw new Error('booking_id or reference_code is required');
          }
          
          const { data: updated, error } = await query.select();
          if (error) throw error;
          return { success: true, updated: updated?.length || 0, bookings: updated || [] };
        }

        throw new Error('Unsupported action for direct Supabase client: ' + action);
      } catch (err) {
        console.error('Supabase direct call failed:', err);
        throw err;
      }
    }

    // Fallback to backend POST endpoint
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...data })
      });

      if (!response.ok) {
        let errorBody = null;
        let textBody = null;
        try {
          errorBody = await response.json();
        } catch (parseError) {
          try {
            textBody = await response.text();
          } catch (textError) {
            textBody = null;
          }
        }
        const message = errorBody?.message || textBody || `API Error: ${response.status}`;
        const err = new Error(message);
        err.status = response.status;
        err.body = errorBody;
        err.text = textBody;
        throw err;
      }

      return await response.json();
    } catch (error) {
      console.error('API call failed:', error);
      throw error;
    }
  }

  try {
    const result = await callBackendAPI('check-connection');
    
    dot.style.background = "#4ade80";
    dot.style.boxShadow = "0 0 10px #4ade80";
    label.textContent = "Connected";
    label.style.color = "#4ade80";
  } catch (err) {
    console.error(err);
    dot.style.background = "#f87171";
    label.textContent = "Offline Mode";
    label.style.color = "#f87171";
  }

  // Booked slots cache for the current selectedDate
  let bookedSlots = {};

  // Helper function to get initials from a name
  function getInitials(name) {
    if (!name) return '?';
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  // Helper function to get remaining time for pending slots (60 mins)
  function getRemainingTime(timestamp) {
    const now = Date.now();
    const elapsed = now - timestamp;
    const sixtyMins = 60 * 60 * 1000;
    if (elapsed >= sixtyMins) return '0:00';
    const remaining = sixtyMins - elapsed;
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function isPendingTimerActive(key) {
    const ts = pendingSlotsWithTimer[key];
    if (!ts) return false;
    const now = Date.now();
    const sixtyMins = 60 * 60 * 1000;
    if (now - ts >= sixtyMins) {
      delete pendingSlotsWithTimer[key];
      return false;
    }
    return true;
  }

  // Load booked slots from backend API for a specific dateKey (YYYY-MM-DD)
  async function loadBookedSlotsForDate(dk) {
    bookedSlots = {};
    try {
      const result = await callBackendAPI('get-booked-slots', { bookingDate: dk });
      if (result.bookings && Array.isArray(result.bookings)) {
        result.bookings.forEach(row => {
          const courtIndex = COURTS.indexOf(row.court);
          if (courtIndex >= 0 && row.time_slot) {
            const status = (row.status || '').toString().toLowerCase();

            const key = `${dk}|${row.time_slot}|${courtIndex}`;

            if (status === 'pending') {
              // Reconstruct pending timer from backend `created_at` so the timer
              // persists across page reloads. Use created_at fallback to now.
              let ts = Date.now();
              try {
                if (row.created_at) ts = new Date(row.created_at).getTime() || Date.now();
              } catch (e) {
                ts = Date.now();
              }
              // Only set pending timer if still within 60 minutes window
              const sixtyMins = 60 * 60 * 1000;
              if ((Date.now() - ts) < sixtyMins) {
                pendingSlotsWithTimer[key] = ts;
              } else {
                delete pendingSlotsWithTimer[key];
              }
              return;
            }

            // If booking is expired or cancelled, treat the slot as available.
            // Clear any local pending marker and do not mark as booked.
            if (status === 'expired' || status === 'cancelled') {
              delete pendingSlotsWithTimer[key];
              if (selectedSlots.has(key)) selectedSlots.delete(key);
              return;
            }

            // Confirmed/active booking statuses should reserve the slot.
            // Treat common reserved statuses as booked; leave other statuses available.
            const reservedStatuses = new Set(['paid', 'unpaid', 'confirmed', 'completed']);
            if (reservedStatuses.has(status)) {
              bookedSlots[key] = row.customer_name || 'Unknown';
              if (pendingSlotsWithTimer[key]) delete pendingSlotsWithTimer[key];
            } else {
              // For any unknown or non-reserving status, ensure it's not left pending locally
              if (pendingSlotsWithTimer[key]) delete pendingSlotsWithTimer[key];
            }
          }
        });
      }
    } catch (e) {
      console.error('loadBookedSlotsForDate error', e);
      // Don't block UI; show a subtle toast if connection failed
      showToast('Could not load bookings (offline)');
    }
  }

  // Helper to load bookings then render table
  async function loadAndRenderTable() {
    const dk = dateKey(selectedDate);
    await loadBookedSlotsForDate(dk);
    renderTable();
  }

  // 24-HOUR SLOTS
  const SLOTS = [
    '12:00 AM - 1:00 AM',
    '1:00 AM - 2:00 AM',
    '2:00 AM - 3:00 AM',
    '3:00 AM - 4:00 AM',
    '4:00 AM - 5:00 AM',
    '5:00 AM - 6:00 AM',
    '6:00 AM - 7:00 AM',
    '7:00 AM - 8:00 AM',
    '8:00 AM - 9:00 AM',
    '9:00 AM - 10:00 AM',
    '10:00 AM - 11:00 AM',
    '11:00 AM - 12:00 PM',
    '12:00 PM - 1:00 PM',
    '1:00 PM - 2:00 PM',
    '2:00 PM - 3:00 PM',
    '3:00 PM - 4:00 PM',
    '4:00 PM - 5:00 PM',
    '5:00 PM - 6:00 PM',
    '6:00 PM - 7:00 PM',
    '7:00 PM - 8:00 PM',
    '8:00 PM - 9:00 PM',
    '9:00 PM - 10:00 PM',
    '10:00 PM - 11:00 PM',
    '11:00 PM - 12:00 AM'
  ];

  const COURTS = ['Court One', 'Court Two'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let selectedDate = new Date();
  let today = new Date();
  let viewMonth = today.getMonth();
  let viewYear = today.getFullYear();

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatDateDisplay(d) {
    if (typeof d === 'string' || typeof d === 'number') {
      d = new Date(d);
    }
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      return String(d || '');
    }
    return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  // Day rate: 6AM-6PM (slots starting 6AM through 5PM)
  // Night rate: 6PM-6AM (slots starting 6PM through 5AM)
  function getRate(slot) {
    if (TEST_MODE_FORCE_ONE_PHP) {
      return 1;
    }
    const daySlots = [
      '6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
      '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'
    ];
    return daySlots.some(t => slot.startsWith(t)) ? 450 : 500;
  }

  // Helper function to check if a slot is in the past
  function isSlotPast(dateKey, slot) {
    // Past slot labeling no longer blocks selection.
    return false;
  }

  function renderCalendar() {
    const grid = document.getElementById('calGrid');
    grid.innerHTML = '';
    document.getElementById('calMonthYear').textContent = `${MONTHS[viewMonth]} ${viewYear}`;

    DAYS.forEach(day => {
      const el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = day;
      grid.appendChild(el);
    });

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day empty';
      grid.appendChild(empty);
    }

    for (let d = 1; d <= totalDays; d++) {
      const day = document.createElement('div');
      day.className = 'cal-day';
      day.textContent = d;

      const thisDate = new Date(viewYear, viewMonth, d);
      const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
      const isSelected = d === selectedDate.getDate() && viewMonth === selectedDate.getMonth() && viewYear === selectedDate.getFullYear();
      const isPast = thisDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());

      if (isToday) day.classList.add('today');
      if (isSelected && !isToday) day.classList.add('selected');
      if (isPast) day.classList.add('past');

      day.onclick = () => {
        selectedDate = new Date(viewYear, viewMonth, d);
        renderCalendar();
        loadAndRenderTable();
      };

      grid.appendChild(day);
    }
  }

  document.getElementById('prevBtn').onclick = () => {
    viewMonth--;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    }
    renderCalendar();
    loadAndRenderTable();
  };

  document.getElementById('nextBtn').onclick = () => {
    viewMonth++;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    renderCalendar();
    loadAndRenderTable();
  };

  window.goToToday = function() {
    selectedDate = new Date(today);
    viewMonth = today.getMonth();
    viewYear = today.getFullYear();
    renderCalendar();
    loadAndRenderTable();
  };

  function renderTable() {
    const dk = dateKey(selectedDate);
    document.getElementById('selectedDateLabel').textContent = formatDateDisplay(selectedDate);

    const body = document.getElementById('slotBody');
    body.innerHTML = '';

    SLOTS.forEach(slot => {
      const tr = document.createElement('tr');
      
      const tdTime = document.createElement('td');
      tdTime.className = 'time-cell';
      tdTime.textContent = slot;
      tr.appendChild(tdTime);

      COURTS.forEach((court, index) => {
        const tdC = document.createElement('td');
        const key = `${dk}|${slot}|${index}`;
        const btn = document.createElement('button');
        btn.className = 'slot-btn';

        const isPendingActive = isPendingTimerActive(key);

        // If the slot is booked in Supabase, mark as booked and show initials
        if (bookedSlots[key]) {
          btn.classList.add('slot-booked');
          btn.textContent = getInitials(bookedSlots[key]);
          btn.disabled = true;
        }
        // Check if slot is pending (receipt uploaded, awaiting admin confirmation)
        else if (isPendingActive) {
          btn.classList.add('slot-pending');
          const remaining = getRemainingTime(pendingSlotsWithTimer[key]);
          btn.textContent = `PENDING\n${remaining}`;
          btn.style.whiteSpace = 'pre-wrap';
          btn.disabled = true;
        } else if (selectedSlots.has(key)) {
          btn.classList.add('slot-selected');
          btn.textContent = '✓ Selected';
        } else {
          btn.classList.add('slot-available');
          btn.textContent = 'Available';
        }

        btn.onclick = () => {
          // Prevent selecting a slot that just became booked or is in the past
          if (btn.disabled) return;
          if (selectedSlots.has(key)) {
            selectedSlots.delete(key);
          } else {
            selectedSlots.add(key);
          }
          updateCart();
          renderTable();
        };

        tdC.appendChild(btn);
        tr.appendChild(tdC);
      });

      body.appendChild(tr);
    });
  }

  function updateCart() {
    const count = selectedSlots.size;
    const total = [...selectedSlots].reduce((sum, key) => {
      return sum + getRate(key.split('|')[1]);
    }, 0);

    document.getElementById('cartCount').textContent = `${count} slot${count !== 1 ? 's' : ''} selected`;
    document.getElementById('cartTotal').textContent = `₱${total.toLocaleString()}`;
    document.getElementById('cartBar').classList.toggle('visible', count > 0);
  }

  window.clearForm = function() {
    selectedSlots.clear();
    updateCart();
    loadAndRenderTable();
    closeModal();
    closeSuccessModal();
    const refInput = document.getElementById('searchRef');
    if (refInput) refInput.value = '';
    showToast("🧹 Selection cleared!");
  };

  window.openModal = function() {
    // Open the reference search modal (no selection required)
    const refInput = document.getElementById('searchRef');
    if (refInput) refInput.value = '';
    document.getElementById('bookingModal').classList.add('open');
    setTimeout(() => { const el = document.getElementById('searchRef'); if (el) el.focus(); }, 120);
    updateCheckButtonState();
  };

  // Open the confirm modal which summarizes selected slots and collects name/phone
  window.openConfirmModal = function() {
    const container = document.getElementById('confirmSlotsContainer');
    const dateEl = document.getElementById('confirmDate');
    const countEl = document.getElementById('confirmCount');
    const totalEl = document.getElementById('confirmTotal');
    const nameEl = document.getElementById('confirmName');
    const phoneEl = document.getElementById('confirmPhone');
    const confirmBtn = document.getElementById('confirmModalBtn');

    if (!container || !dateEl || !countEl || !totalEl) return openModal();

    // Populate date
    dateEl.textContent = formatDateDisplay(selectedDate);

    // Build selected slots list
    container.innerHTML = '';
    const sel = [...selectedSlots];
    let total = 0;
    sel.forEach(key => {
      const parts = key.split('|');
      const date = parts[0];
      const slot = parts[1];
      const courtIndex = parseInt(parts[2], 10);
      const court = COURTS[courtIndex] || 'Court';
      const price = getRate(slot);
      total += price;

      const card = document.createElement('div');
      card.style.background = 'rgba(255,255,255,0.02)';
      card.style.padding = '12px';
      card.style.borderRadius = '8px';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';

      const left = document.createElement('div');
      left.innerHTML = `<div style="font-weight:700;color:#e5e7eb;">${court}</div><div style="color:#9ca3af;font-size:0.9rem;">${slot}</div>`;
      const right = document.createElement('div');
      right.style.color = 'var(--accent)';
      right.style.fontWeight = '800';
      right.textContent = `₱${price}`;

      card.appendChild(left);
      card.appendChild(right);
      container.appendChild(card);
    });

    countEl.textContent = sel.length;
    totalEl.textContent = `₱${total}`;

    // Prefill name/phone from booking modal fields if available
    const existingName = document.getElementById('bookingName');
    const existingPhone = document.getElementById('bookingPhone');
    if (nameEl) nameEl.value = existingName ? existingName.value : '';
    if (phoneEl) phoneEl.value = existingPhone ? existingPhone.value : '';

    // open modal
    document.getElementById('confirmModal').classList.add('open');
    setTimeout(() => { if (nameEl) nameEl.focus(); }, 120);

    // Wire input events for validation
    function updateConfirmModalButtonState() {
      const name = (document.getElementById('confirmName') || {}).value || '';
      const phone = (document.getElementById('confirmPhone') || {}).value || '';
      if (!confirmBtn) return;
      confirmBtn.disabled = !(name.trim() && phone.trim());
    }

    if (nameEl) nameEl.addEventListener('input', updateConfirmModalButtonState);
    if (phoneEl) phoneEl.addEventListener('input', updateConfirmModalButtonState);
    updateConfirmModalButtonState();
  };

  window.closeConfirmModal = function() { document.getElementById('confirmModal').classList.remove('open'); };

  window.toggleSuccessPaymentExtension = async function() {
    const checkbox = document.getElementById('successSaveCopy');
    const section = document.getElementById('successPaySection');
    const nextSteps = document.querySelector('.next-steps-card');
    const messengerBtn = document.querySelector('.btn-messenger');
    const actionText = document.getElementById('successPayActionText');
    if (!checkbox || !section || !nextSteps) return;
    if (checkbox.checked) {
      section.style.display = 'block';
      nextSteps.style.display = 'grid';
      if (messengerBtn) messengerBtn.style.display = 'inline-flex';
      if (actionText) actionText.textContent = 'You may now scan the QR code and upload your payment receipt to complete this booking.';
      await downloadBookingConfirmationImage();
    } else {
      section.style.display = 'none';
      nextSteps.style.display = 'none';
      if (messengerBtn) messengerBtn.style.display = 'none';
      if (actionText) actionText.textContent = 'Check the box to reveal the scan-to-pay section and upload your receipt proof.';
    }
  };

  async function downloadBookingConfirmationImage() {
    const target = document.querySelector('.success-download-card') || document.querySelector('.success-body-box');
    if (!target || !window.html2canvas) {
      console.warn('Cannot download booking image: target or html2canvas missing');
      return;
    }

    try {
      const canvas = await html2canvas(target, {
        backgroundColor: '#08090d',
        scale: Math.min(2, window.devicePixelRatio || 1)
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const safeRef = (receiptBookingReference || 'booking-confirmation').replace(/[^a-zA-Z0-9-_]/g, '_');
      link.href = dataUrl;
      link.download = `${safeRef}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('✅ Booking confirmation image downloaded');
    } catch (err) {
      console.error('Booking image download failed', err);
      showToast('❌ Failed to download booking image');
    }
  }


  function renderSuccessBookingItems(entries) {
    const container = document.getElementById('successBookingItems');
    if (!container) return;
    container.innerHTML = '';
    if (!entries || entries.length === 0) return;

    const grouped = entries.reduce((acc, entry) => {
      const courtName = entry.court_name || entry.court || 'Court';
      const timeText = entry.booking_time || entry.time_slot || '';
      const date = entry.booking_date || '';
      const key = `${courtName}||${timeText}||${date}`;
      if (!acc[key]) {
        acc[key] = {
          courtName,
          timeText,
          count: 0,
          amount: 0,
          status: (entry.status || 'pending').toUpperCase()
        };
      }
      acc[key].count += 1;
      acc[key].amount += (entry.price || entry.rate || 0);
      return acc;
    }, {});

    Object.values(grouped).forEach(item => {
      const row = document.createElement('div');
      row.className = 'success-booking-item';
      row.innerHTML = `
        <div class="success-booking-item-info">
          <div class="success-booking-item-title">${item.courtName}${item.count > 1 ? ` ×${item.count}` : ''}</div>
          <div class="success-booking-item-meta">${item.timeText || '—'}</div>
        </div>
        <div class="success-booking-item-right">
          <div class="success-booking-item-price">₱${item.amount.toLocaleString()}</div>
          <span class="status-badge pending">${item.status}</span>
        </div>
      `;
      container.appendChild(row);
    });
  }

  window.openBookingSubmittedModal = function(reference, totalAmount) {
    receiptBookingReference = reference;
    receiptBookingTotal = totalAmount;

    const titleEl = document.getElementById('successTitle');
    const messageEl = document.getElementById('successMessage');
    const nameEl = document.getElementById('successName');
    const courtEl = document.getElementById('successCourt');
    const dateEl = document.getElementById('successDate');
    const timeEl = document.getElementById('successTime');
    const paidTotalEl = document.getElementById('successPaidTotal');
    const refCodeEl = document.getElementById('bookingRefCode');
    const statusEl = document.getElementById('successBookingStatus');
    const expiryEl = document.getElementById('successExpiryNote');
    const saveCopyCheckbox = document.getElementById('successSaveCopy');
    const paySection = document.getElementById('successPaySection');
    const actionText = document.getElementById('successPayActionText');

    if (titleEl) titleEl.textContent = 'Booking Submitted!';
    if (messageEl) messageEl.textContent = 'Save a copy of this confirmation. When you are ready, scan to pay and upload your receipt proof.';
    if (refCodeEl) refCodeEl.textContent = reference;
    if (statusEl) statusEl.textContent = 'PENDING';
    if (expiryEl) expiryEl.textContent = 'Expires in 4 hours if not confirmed';
    if (actionText) actionText.textContent = 'Check the box to reveal the scan-to-pay section and upload your receipt proof.';

    const messengerBtn = document.querySelector('.btn-messenger');
    if (messengerBtn) {
      const encodedRef = encodeURIComponent(`Booking Reference: ${reference}`);
      messengerBtn.href = `https://www.messenger.com/t/1070406479496408?ref=${encodedRef}`;
    }
    if (saveCopyCheckbox) saveCopyCheckbox.checked = false;
    if (paySection) paySection.style.display = 'none';
    const nextStepsCard = document.querySelector('.next-steps-card');
    if (nextStepsCard) nextStepsCard.style.display = 'none';
    if (messengerBtn) messengerBtn.style.display = 'none';

    const bookingEntries = [...pendingBookingEntries];
    const successName = bookingEntries[0]?.customer_name || '';
    const successCourt = bookingEntries[0]?.court_name || bookingEntries[0]?.court || '';
    const successDate = bookingEntries[0]?.booking_date ? formatDateDisplay(bookingEntries[0].booking_date) : '';
    const successTime = bookingEntries[0]?.booking_time || bookingEntries[0]?.time_slot || '';
    const successPaidTotal = `₱${totalAmount.toLocaleString()}`;

    if (nameEl) nameEl.textContent = successName;
    if (courtEl) courtEl.textContent = successCourt;
    if (dateEl) dateEl.textContent = successDate;
    if (timeEl) timeEl.textContent = successTime;
    if (paidTotalEl) paidTotalEl.textContent = successPaidTotal;
    const scanTitleAmountEl = document.getElementById('scanTitleAmount');
    if (scanTitleAmountEl) scanTitleAmountEl.textContent = successPaidTotal;

    renderSuccessBookingItems(bookingEntries);
    document.getElementById('successModal').classList.add('open');
    bookingSubmissionTime = Date.now(); // Start 15-minute payment timer when modal opens
  };

  window.removeSlot = function(key) {
    selectedSlots.delete(key);
    updateCart();
    loadAndRenderTable();
    
    if (selectedSlots.size === 0) {
      closeModal();
      showToast('All slots removed');
    } else {
      openModal(); // Re-render modal
    }
  };

  window.closeModal = function() {
    document.getElementById('bookingModal').classList.remove('open');
  };

  window.closeSuccessModal = function() {
    document.getElementById('successModal').classList.remove('open');
    bookingSubmissionTime = null; // Reset timer when modal closes
  };

  window.handleDoneBooking = async function() {
    // Check if receipt was uploaded
    const receiptUploaded = receiptRefUploaded === true;
    const currentRef = receiptBookingReference;
    
    // Close the success modal and return to dashboard
    closeSuccessModal();
    
    // Show message if receipt wasn't uploaded
    if (!receiptUploaded && currentRef) {
      showToast(`📋 Pay Later: Copy your Booking Reference ${currentRef} • Search to pay your reservation`);
    }
    
    // Clear receipt state and pending entries for next booking
    receiptFile = null;
    receiptRefUploaded = false;
    receiptTextExtracted = '';
    receiptBookingReference = '';
    receiptBookingTotal = 0;
    pendingBookingEntries = [];
    selectedSlots.clear();
    
    // Clear input fields
    const refEl = document.getElementById('searchRef');
    if (refEl) refEl.value = '';
    
    // Reload the table to show the new booking in pending or confirmed state
    await loadAndRenderTable();
  };

  // Admin function to confirm a pending booking and copy confirmation message
  window.confirmBooking = async function(referenceCode, bookingDetails) {
    try {
      // Update booking status to confirmed
      const result = await callBackendAPI('confirm-booking', { reference_code: referenceCode });
      
      if (!result.success || result.updated === 0) {
        showToast('❌ Could not confirm booking. Please try again.');
        return;
      }

      // Get all bookings for this reference to build complete confirmation
      const bookings = result.bookings || [];
      const firstBooking = bookings[0] || bookingDetails || {};
      const customerName = firstBooking.customer_name || 'Guest';
      const totalAmount = bookings.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);
      const referenceCodeDisplay = referenceCode || 'N/A';
      
      // Group bookings by date, then by court
      const dateGroups = {};
      bookings.forEach(booking => {
        const date = booking.booking_date || 'N/A';
        const court = booking.court_name || booking.court || 'Court';
        const timeSlot = booking.time_slot || booking.booking_time || '';
        
        if (!dateGroups[date]) {
          dateGroups[date] = {};
        }
        if (!dateGroups[date][court]) {
          dateGroups[date][court] = [];
        }
        dateGroups[date][court].push(timeSlot);
      });

      // Sort dates and build formatted confirmation message
      const sortedDates = Object.keys(dateGroups).sort((a, b) => new Date(a) - new Date(b));
      
      let courtSections = '';
      const courtOrder = ['Court One', 'Court Two'];
      const timeEmojis = ['🕚', '🕛', '🕐', '🕑', '', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙'];
      let emojiIndex = 0;
      
      sortedDates.forEach(date => {
        const formattedDate = new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        courtSections += `\n📅 ${formattedDate}`;
        
        const courts = dateGroups[date];
        courtOrder.forEach(court => {
          if (courts[court] && courts[court].length > 0) {
            const slots = courts[court];
            courtSections += `\n${court}\n`;
            
            slots.forEach((slot) => {
              const timeEmoji = timeEmojis[emojiIndex % timeEmojis.length];
              emojiIndex++;
              courtSections += `${timeEmoji} ${slot}\n`;
            });
          }
        });
      });

      const confirmationMessage = `BOOKING CONFIRMATION

Hello ${customerName},

Thank you for booking with Pickle Social - Cebu! Your reservation has been successfully confirmed. ✅

Name: ${firstBooking.customer_name || ''}
Phone: ${firstBooking.phone_number || ''}
📌 Booking Reference: ${referenceCodeDisplay}
💳 Total Paid: ₱${totalAmount.toLocaleString()}${courtSections}`;

      // Copy to clipboard
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(confirmationMessage);
        showToast('✅ Booking confirmed! Message copied to clipboard.');
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = confirmationMessage;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('✅ Booking confirmed! Message copied to clipboard.');
      }

      // Reload table to update status
      await loadAndRenderTable();
    } catch (err) {
      console.error('Error confirming booking:', err);
      showToast('❌ Error confirming booking. Please try again.');
    }
  };

  window.submitBooking = async function() {
    // Read values from either the detailed booking modal or the compact confirm modal
    // Prefer values from the confirm modal when present (user-filled there)
    const nameField = document.getElementById('confirmName') || document.getElementById('bookingName');
    const phoneField = document.getElementById('confirmPhone') || document.getElementById('bookingPhone');
    const notesField = document.getElementById('bookingNotes');

    const name = nameField ? nameField.value.trim() : '';
    const phone = phoneField ? phoneField.value.trim() : '';
    const notes = notesField ? notesField.value.trim() : '';

    // Require name and phone
    if (!name || !phone) {
      showToast('⚠️ Please fill in your name and phone');
      return;
    }

    const confirmBtn = document.getElementById('confirmBtn') || document.getElementById('confirmModalBtn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing...';
    }

    try {
      // Generate booking reference
      const refCode = 'PKL-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

      // Prepare booking data and keep it pending until receipt verification
      pendingBookingEntries = [...selectedSlots].map(key => {
        const [date, slot, courtIndex] = key.split('|');
        const payload = {
          reference_code: refCode,
          customer_name: name,
          phone_number: '+63' + phone.replace(/\D/g, ''),
          booking_date: date,
          booking_time: slot,
          time_slot: slot,
          court_name: COURTS[parseInt(courtIndex)],
          court: COURTS[parseInt(courtIndex)],
          price: getRate(slot),
          rate: getRate(slot),
          status: 'pending',
          fromExistingBooking: false,
          persistedInDb: false
        };
        // Email field removed from the form; do not include customer_email here
        if (notes) payload.notes = notes;
        return payload;
      });

      const totalAmount = pendingBookingEntries.reduce((s, b) => s + (b.price || 0), 0);

      // Persist pending booking entries to Supabase immediately so the admin dashboard can show them
      try {
        const bookingsToSave = pendingBookingEntries.map(entry => ({
          booking_date: entry.booking_date,
          booking_time: entry.booking_time,
          time_slot: entry.time_slot,
          court: entry.court,
          court_name: entry.court_name,
          customer_name: entry.customer_name,
          phone_number: entry.phone_number,
          reference_code: entry.reference_code,
          status: entry.status,
          price: entry.price,
          rate: entry.rate,
          notes: entry.notes
        }));

        const insertResult = await callBackendAPI('bulk-insert-bookings', { bookings: bookingsToSave });
        if (!insertResult.success) {
          throw new Error(insertResult.error || 'Failed to save pending booking');
        }

        pendingBookingEntries.forEach(entry => {
          entry.persistedInDb = true;
        });
      } catch (err) {
        console.error('Error saving pending booking:', err);
        showToast('❌ Failed to save booking. Please try again.');
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Next';
        }
        return;
      }

      // Mark selected slots as pending with 30-minute timer
      selectedSlots.forEach(key => {
        const [date, slot, courtIndex] = key.split('|');
        const slotKey = `${date}|${slot}|${courtIndex}`;
        pendingSlotsWithTimer[slotKey] = Date.now(); // 30-minute pending timer
      });
      startPendingPoll(); // Start polling to detect admin confirmations

      // Close booking/confirm modal and show the booking submitted summary
      closeModal();
      closeConfirmModal();
      openBookingSubmittedModal(refCode, totalAmount);

      showToast('✅ Booking submitted! Save a copy and proceed to scan payment.');

    } catch (err) {
      console.error('Booking error:', err);
      showToast('Booking failed. Please try again.');
    } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Next';
        }
    }
  };

  function updateConfirmButtonState() {
    const confirmBtn = document.getElementById('confirmBtn');
    const nameEl = document.getElementById('bookingName');
    const phoneEl = document.getElementById('bookingPhone');
    if (!confirmBtn || !nameEl || !phoneEl) return;
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    confirmBtn.disabled = !(name && phone);
  }

  // new: enable/disable the 'Check Status' button based on input
  function updateCheckButtonState() {
    const btn = document.getElementById('checkRefBtn');
    const ref = document.getElementById('searchRef');
    if (!btn) return;
    btn.disabled = !ref || !ref.value.trim();
  }

  const searchInputEl = document.getElementById('searchRef');
  if (searchInputEl) {
    searchInputEl.addEventListener('input', updateCheckButtonState);
    searchInputEl.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        const btn = document.getElementById('checkRefBtn');
        if (btn && !btn.disabled) checkReference();
      }
    });
  }

    // Wire booking form inputs to enable/disable the Confirm button
    const bookingNameEl = document.getElementById('bookingName');
    const bookingEmailEl = document.getElementById('bookingEmail');
    const bookingPhoneEl = document.getElementById('bookingPhone');
    const bookingNotesEl = document.getElementById('bookingNotes');
    const confirmBtnEl = document.getElementById('confirmBtn');

    function attachBookingInputListeners() {
      const inputs = [bookingNameEl, bookingEmailEl, bookingPhoneEl];
      inputs.forEach(inp => {
        if (!inp) return;
        inp.addEventListener('input', updateConfirmButtonState);
      });
      updateConfirmButtonState();
    }

    attachBookingInputListeners();

  // Search-by-reference handler
  window.checkReference = async function() {
    const refEl = document.getElementById('searchRef');
    const btn = document.getElementById('checkRefBtn');
    const resultsEl = document.getElementById('bookingCheckResults');
    const contentEl = document.getElementById('bookingResultsContent');
    const payBtn = document.getElementById('payNowBtn');

    if (!refEl) return;
    const ref = refEl.value.trim();
    if (!ref) {
      showToast('⚠️ Please enter a reference number');
      return;
    }

    if (btn) {
      btn.disabled = true;
      var prevText = btn.textContent;
      btn.textContent = 'Checking...';
    }

    try {
      const result = await callBackendAPI('get-booking-by-reference', { reference: ref });
      console.log('Search result:', result);
      
      if (!result || !result.bookings || result.bookings.length === 0) {
        if (contentEl) {
          contentEl.innerHTML = '<div style="color:#f87171;text-align:center;padding:16px;">🔎 Reference not found</div>';
        }
        if (resultsEl) resultsEl.style.display = 'block';
        if (payBtn) payBtn.style.display = 'none';
        return;
      }

      const status = result.bookings.some(b => b.status === 'pending')
        ? 'pending'
        : result.bookings.some(b => b.status === 'paid')
          ? 'paid'
          : result.bookings[0]?.status || 'pending';
      receiptBookingReference = ref;
      const totalAmount = result.bookings.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);
      
      let displayDate = 'N/A';
      try {
        const bookingDate = result.bookings[0]?.booking_date;
        if (bookingDate) {
          displayDate = formatDateDisplay(bookingDate);
        }
      } catch (dateErr) {
        console.warn('Error formatting date:', dateErr);
        displayDate = result.bookings[0]?.booking_date || 'N/A';
      }

      const courtGroups = {};
      if (Array.isArray(result.bookings)) {
        result.bookings.forEach(booking => {
          const courtName = booking.court_name || booking.court || 'Court';
          const timeSlot = booking.time_slot || booking.booking_time || 'Unknown time';
          if (!courtGroups[courtName]) {
            courtGroups[courtName] = [];
          }
          courtGroups[courtName].push(timeSlot);
        });
      }

      const timeEmojis = ['🕚', '🕛', '🕐', '🕑', '�', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙'];
      const courtSections = Object.entries(courtGroups).map(([court, times]) => {
        const sortedTimes = times.slice().sort();
        const timesHtml = sortedTimes.map((time, index) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span>${timeEmojis[index % timeEmojis.length]}</span>
            <span style="color:#f8fafc;">${time}</span>
          </div>
        `).join('');
        return `
          <div style="padding:12px;border-radius:12px;border:1px solid rgba(236,72,153,0.14);background:rgba(255,255,255,0.03);">
            <div style="font-weight:700;color:#f8fafc;margin-bottom:8px;">${court}</div>
            ${timesHtml}
          </div>
        `;
      }).join('');

      let resultHtml = '<div style="display:flex;flex-direction:column;gap:12px;">';
      if (status === 'paid' || status === 'confirmed') {
        resultHtml += `
          <div style="text-align:center;padding:16px;border:2px solid #10b981;border-radius:12px;background:rgba(16,185,129,0.1);">
            <div style="font-size:1.2rem;margin-bottom:8px;">✅ Booking Confirmed</div>
            <div style="color:#a7f3d0;font-weight:700;">Reference: ${ref}</div>
          </div>
        `;
        if (payBtn) payBtn.style.display = 'none';
      } else if (status === 'pending') {
        resultHtml += `
          <div style="text-align:center;padding:16px;border:2px solid #f59e0b;border-radius:12px;background:rgba(245,158,11,0.1);">
            <div style="font-size:1.1rem;margin-bottom:8px;">⏳ Booking Pending Payment</div>
            <div style="color:#fcd34d;">Payment required to confirm</div>
          </div>
        `;
        if (payBtn) payBtn.style.display = 'inline-block';
        receiptBookingTotal = totalAmount;

        pendingBookingEntries = result.bookings.map(booking => ({
          booking_date: booking.booking_date,
          booking_time: booking.booking_time || booking.time_slot,
          time_slot: booking.time_slot || booking.booking_time,
          court: booking.court || booking.court_name,
          court_name: booking.court_name || booking.court,
          customer_name: booking.customer_name || '',
          phone_number: booking.phone_number || '',
          reference_code: booking.reference_code || ref,
          price: booking.price || booking.rate || 0,
          rate: booking.rate || booking.price || 0,
          status: booking.status || 'pending',
          notes: booking.notes,
          fromExistingBooking: true,
          persistedInDb: true
        }));
      }

      resultHtml += `
        <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:12px;border:1px solid rgba(236,72,153,0.14);">
          <div style="font-size:1rem;margin-bottom:8px;">💳 Total Paid: ₱${totalAmount}</div>
          <div style="font-size:1rem;">📅 Date: ${displayDate}</div>
        </div>
      `;
      resultHtml += courtSections;
      resultHtml += '</div>';

      if (contentEl) contentEl.innerHTML = resultHtml;
      if (resultsEl) resultsEl.style.display = 'block';

    } catch (err) {
      console.error('Search error:', err);
      console.error('Error details:', {
        message: err?.message,
        status: err?.status,
        body: err?.body,
        stack: err?.stack
      });
      if (contentEl) {
        const errorMsg = err?.message || 'Unknown error';
        contentEl.innerHTML = `<div style="color:#f87171;text-align:center;padding:16px;">❌ Error: ${errorMsg}</div>`;
      }
      if (resultsEl) resultsEl.style.display = 'block';
      if (payBtn) payBtn.style.display = 'none';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText || 'Check Status';
      }
    }
  };

  receiptBookingReference = '';
  receiptBookingTotal = 0;
  let receiptTextExtracted = '';

  let receiptTimerInterval = null;
  let receiptModalTimeout = null;

  function clearReceiptModalTimer() {
    if (receiptTimerInterval) {
      clearInterval(receiptTimerInterval);
      receiptTimerInterval = null;
    }
    if (receiptModalTimeout) {
      clearTimeout(receiptModalTimeout);
      receiptModalTimeout = null;
    }
  }

  window.triggerReceiptUpload = function() {
    const input = document.getElementById('receiptFileInput');
    if (input) input.click();
  };

  // Refresh available slots from server and re-render table
  window.refreshSlots = async function() {
    try {
      const refreshBtn = document.getElementById('refreshBtn');
      if (refreshBtn) {
        refreshBtn.disabled = true;
        const prev = refreshBtn.textContent;
        refreshBtn.textContent = 'Refreshing...';
        await loadAndRenderTable();
        refreshBtn.textContent = prev || 'Refresh';
        refreshBtn.disabled = false;
      } else {
        await loadAndRenderTable();
      }
      showToast('Slots refreshed');
    } catch (err) {
      console.error('Failed to refresh slots', err);
      showToast('Failed to refresh slots');
      const refreshBtn = document.getElementById('refreshBtn');
      if (refreshBtn) refreshBtn.disabled = false;
    }
  };

  window.openReceiptModal = function(reference, totalAmount) {
    clearReceiptModalTimer();
    // Use global variables as fallback if parameters aren't provided
    receiptBookingReference = reference || receiptBookingReference || '';
    receiptBookingTotal = totalAmount != null ? totalAmount : receiptBookingTotal;
    receiptTextExtracted = '';
    receiptFile = null;
    receiptRefUploaded = false;
    updateSuccessReceiptUploadState();

    const bookingRefField = document.getElementById('receiptBookingRef');
    const refField = document.getElementById('receiptRef');
    const amountField = document.getElementById('receiptAmount');
    const dateTimeField = document.getElementById('receiptDateTime');
    const statusField = document.getElementById('receiptScanStatus');
    const mismatchField = document.getElementById('receiptMismatch');
    const verifyBtn = document.getElementById('verifyReceiptBtn');
    const previewContainer = document.getElementById('receiptPreviewContainer');
    const fileInput = document.getElementById('receiptFileInput');
    const previewImg = document.getElementById('receiptPreview');
    const removeBtn = document.getElementById('receiptRemoveBtn');

    if (bookingRefField) bookingRefField.textContent = receiptBookingReference || '—';
    if (refField) refField.textContent = 'Waiting for receipt scan...';
    if (amountField) amountField.textContent = receiptBookingTotal ? `₱${receiptBookingTotal.toLocaleString()}` : '₱0';
    if (dateTimeField) dateTimeField.textContent = 'Waiting for upload...';
    if (statusField) statusField.textContent = 'Upload the GCash receipt image to verify payment.';
    if (mismatchField) mismatchField.textContent = '';
    if (verifyBtn) verifyBtn.disabled = true;
    if (previewContainer) previewContainer.style.display = 'none';
    if (fileInput) fileInput.value = '';
    if (previewImg) previewImg.src = '';
    if (removeBtn) removeBtn.style.display = 'none';
    const timerField = document.getElementById('receiptTimer');
    if (timerField) timerField.textContent = 'Time remaining: 60:00';

    const expiry = Date.now() + 60 * 60 * 1000;
    receiptTimerInterval = setInterval(() => {
      const remainingMs = expiry - Date.now();
      if (remainingMs <= 0) {
        if (timerField) timerField.textContent = 'Time remaining: 00:00';
        clearReceiptModalTimer();
        closeReceiptModal();
        showToast('Payment time expired. Please reopen the receipt upload and try again.');
        return;
      }
      const minutes = Math.floor(remainingMs / 60000);
      const seconds = Math.floor((remainingMs % 60000) / 1000);
      if (timerField) timerField.textContent = `Time remaining: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
    receiptModalTimeout = setTimeout(() => {
      clearReceiptModalTimer();
      closeReceiptModal();
      showToast('Payment time expired. Please reopen the receipt upload and try again.');
    }, 60 * 60 * 1000);

    document.getElementById('receiptModal').classList.add('open');
  };

  window.closeReceiptModal = function() {
    clearReceiptModalTimer();
    document.getElementById('receiptModal').classList.remove('open');
    clearReceiptUpload();
  };

  function parseReceiptText(text) {
    const cleaned = (text || '')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[\u00A0\u202F\u2060]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const upper = cleaned.toUpperCase();

    const dateMatch = upper.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})|(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/);
    const timeMatch = upper.match(/(\d{1,2}:\d{2}\s*(AM|PM))|(\d{1,2}:\d{2})/);
    const refMatch = upper.match(/(?:RECEIPT\s*REFERENCE|RECEIPT\s*REF(?:ERENCE)?|RECEIPT\s*NO|RECEIPT\s*#|REF(?:ERENCE)?(?:\s*NO\.?)?|RRN|REFERENCE(?:\s*NO)?|REF#|REFERENCE#|BOOKING\s*REF)[\s:\-]*([A-Z0-9\-\s]{4,})/i);
    const fallbackRefMatch = upper.match(/(?:REF(?:\.|\s*NO\.?|\s*NUMBER)?|RRN|REFERENCE)[\s:\-]*([0-9][0-9\s\-]{8,})/i)
      || upper.match(/\b(\d{4}\s*\d{3}\s*\d{6,7})\b/);
    const amountMatch = upper.match(/(?:TOTAL\s*AMOUNT\s*SENT|TOTAL\s*AMOUNT|TOTAL\s*PAID|AMOUNT\s*PAID|AMOUNT\s*SENT|GRAND\s*TOTAL|AMOUNT|TOTAL)(?:\s*[:\-]?\s*)₱?\s*([\d,]+\.\d{2}|[\d,]+)/i)
      || upper.match(/₱\s*([\d,]+\.\d{1,2}|[\d,]+)/);

    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;
    const extractedRef = (refMatch || fallbackRefMatch) ? (refMatch || fallbackRefMatch)[1].trim() : '';
    const digitsMatch = cleaned.match(/\b(\d(?:[\s\-]?\d){12})\b/);
    const extracted13Digits = digitsMatch ? digitsMatch[1].replace(/\D/g, '') : extractedRef.replace(/\D/g, '').slice(0, 13);
    const reference = extracted13Digits.length === 13 ? extracted13Digits : '';
    const date = dateMatch ? dateMatch[0] : '';
    const time = timeMatch ? timeMatch[0] : '';

    return { raw: cleaned, date, time, amount, reference };
  }

  function setReceiptFields(parsed) {
    const refField = document.getElementById('receiptRef');
    const amountField = document.getElementById('receiptAmount');
    const dateTimeField = document.getElementById('receiptDateTime');

    if (refField) refField.textContent = parsed.reference || 'Not found';
    if (amountField) amountField.textContent = parsed.amount != null ? `₱${parsed.amount.toLocaleString()}` : `₱${receiptBookingTotal.toLocaleString()}`;
    if (dateTimeField) dateTimeField.textContent = [parsed.date, parsed.time].filter(Boolean).join(' ') || 'Date / time not found';
  }



  function getParsedReceiptData() {
    return receiptTextExtracted ? parseReceiptText(receiptTextExtracted) : { reference: '', amount: null };
  }

  function updateReceiptVerificationState() {
    const verifyBtn = document.getElementById('verifyReceiptBtn');
    const statusEl = document.getElementById('receiptScanStatus');
    if (!verifyBtn) return;

    const parsed = getParsedReceiptData();
    const reference = parsed.reference;
    const amount = parsed.amount;
    const hasReceiptFile = Boolean(receiptFile);
    const amountMissing = amount == null;
    const amountMatches = amountMissing ? false : Number(amount.toFixed(2)) === Number(receiptBookingTotal.toFixed(2));
    const valid = hasReceiptFile && reference && amountMatches;

    verifyBtn.disabled = !valid;

    if (statusEl) {
      if (!hasReceiptFile) {
        statusEl.textContent = 'Upload the receipt screenshot to continue.';
      } else if (!reference) {
        statusEl.textContent = 'Receipt reference could not be detected. Try a clearer photo.';
      } else if (amountMissing) {
        statusEl.textContent = 'Receipt amount could not be detected. Try a clearer photo.';
      } else if (!amountMatches) {
        statusEl.textContent = 'Receipt total does not match booking total. Check the amount.';
      } else {
        statusEl.textContent = 'Ready to verify receipt.';
      }
    }
  }

  async function decodeReceiptImage(file) {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve({ canvas, dataUrl: reader.result });
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.handleReceiptFile = async function(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    receiptFile = file;
    const statusEl = document.getElementById('receiptScanStatus');
    const previewContainer = document.getElementById('receiptPreviewContainer');
    const previewImg = document.getElementById('receiptPreview');
    const verifyBtn = document.getElementById('verifyReceiptBtn');
    const mismatchEl = document.getElementById('receiptMismatch');
    const removeBtn = document.getElementById('receiptRemoveBtn');
    const uploadBtn = document.getElementById('receiptUploadBtn');
    const uploadNote = document.getElementById('receiptUploadedNote');
    const fileInput = document.getElementById('receiptFileInput');

    if (statusEl) statusEl.textContent = 'Reading receipt and scanning QR...';
    if (mismatchEl) mismatchEl.textContent = '';
    if (previewContainer) previewContainer.style.display = 'none';
    if (verifyBtn) verifyBtn.disabled = true;
    if (removeBtn) removeBtn.style.display = 'none';
    if (uploadBtn) uploadBtn.disabled = true;
    if (fileInput) fileInput.disabled = true;
    if (uploadNote) {
      uploadNote.style.display = 'none';
    }

    try {
      const { canvas, dataUrl } = await decodeReceiptImage(file);
      if (previewImg) previewImg.src = dataUrl;
      if (previewContainer) previewContainer.style.display = 'flex';
      if (removeBtn) removeBtn.style.display = 'inline-flex';

      let qrText = '';
      if (window.jsQR) {
        try {
          const ctx = canvas.getContext('2d');
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(imageData.data, imageData.width, imageData.height);
          if (qr && qr.data) {
            qrText = qr.data;
          }
        } catch (e) {
          console.warn('QR scan failed', e);
        }
      }

      let parsedText = '';
      if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
        const result = await Tesseract.recognize(canvas, 'eng', {
          logger: m => {
            if (m.status === 'recognizing text' && m.progress === 1) {
              console.log('Tesseract completed');
            }
          }
        });
        parsedText = result?.data?.text || '';
      }

      if (!parsedText) {
        if (statusEl) statusEl.textContent = 'Receipt text could not be extracted. Please try a clearer image.';
        updateReceiptVerificationState();
        return;
      }

      receiptTextExtracted = parsedText;
      const parsed = parseReceiptText(parsedText);
      setReceiptFields(parsed);

      let mismatchMessage = '';
      if (parsed.amount != null && Number(parsed.amount.toFixed(2)) !== Number(receiptBookingTotal.toFixed(2))) {
        mismatchMessage += `Amount mismatch: receipt shows ₱${parsed.amount.toLocaleString()} but booking total is ₱${receiptBookingTotal.toLocaleString()}. `;
      }
      if (statusEl) {
        const summary = [parsed.date, parsed.time, parsed.reference, parsed.amount != null ? `₱${parsed.amount.toLocaleString()}` : null].filter(Boolean).join(' · ');
        statusEl.textContent = qrText ? `QR scanned · ${summary}` : `Receipt data extracted · ${summary}`;
      }
      if (mismatchEl) mismatchEl.textContent = mismatchMessage;
      const hasReceiptRef = Boolean(parsed.reference);
      receiptRefUploaded = hasReceiptRef;
      updateSuccessReceiptUploadState();
      updateReceiptVerificationState();

      if (uploadNote && hasReceiptRef) {
        uploadNote.style.display = 'block';
        uploadNote.textContent = '✅ Receipt uploaded!';
      }

      if (!hasReceiptRef) {
        if (uploadBtn) {
          uploadBtn.disabled = false;
        }
        if (fileInput) fileInput.disabled = false;
      }

    } catch (err) {
      console.error('Receipt upload error', err);
      if (statusEl) statusEl.textContent = 'Failed to read receipt. Please upload a clear image.';
      if (uploadBtn) uploadBtn.disabled = false;
      if (fileInput) fileInput.disabled = false;
      if (uploadNote) uploadNote.style.display = 'none';
      receiptRefUploaded = false;
      updateSuccessReceiptUploadState();
    }
  };

  window.clearReceiptUpload = function() {
    receiptTextExtracted = '';
    receiptFile = null;
    const statusEl = document.getElementById('receiptScanStatus');
    const previewContainer = document.getElementById('receiptPreviewContainer');
    const previewImg = document.getElementById('receiptPreview');
    const previewRemoveBtn = document.getElementById('receiptRemoveBtn');
    const fileInput = document.getElementById('receiptFileInput');
    const verifyBtn = document.getElementById('verifyReceiptBtn');
    const mismatchEl = document.getElementById('receiptMismatch');
    const uploadBtn = document.getElementById('receiptUploadBtn');
    const uploadNote = document.getElementById('receiptUploadedNote');

    if (previewImg) previewImg.src = '';
    if (previewContainer) previewContainer.style.display = 'none';
    if (previewRemoveBtn) previewRemoveBtn.style.display = 'none';
    if (fileInput) {
      fileInput.value = '';
      fileInput.disabled = false;
    }
    if (uploadBtn) uploadBtn.disabled = false;
    if (uploadNote) uploadNote.style.display = 'none';
    if (verifyBtn) verifyBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Receipt upload removed. Choose a different image.';
    if (mismatchEl) mismatchEl.textContent = '';
    receiptRefUploaded = false;
    updateSuccessReceiptUploadState();
  };

  // NOTE: For full protection against race conditions, add a unique DB constraint
  // on bookings(booking_date, time_slot, court) in Supabase. This front-end check helps
  // catch conflicts early, but the database constraint is the final guard.
  // Example SQL for Supabase SQL editor:
  // ALTER TABLE bookings
  //   ADD CONSTRAINT bookings_unique_slot
  //   UNIQUE (booking_date, time_slot, court);
  async function checkSlotAvailability(entries) {
    if (!entries || entries.length === 0) {
      return { ok: true, conflicts: [] };
    }

    const date = entries[0].booking_date;
    if (!date) {
      return { ok: false, conflicts: [] };
    }

    try {
      const result = await callBackendAPI('get-booked-slots', { bookingDate: date });
      
      const bookedMap = new Map();
      (result.bookings || []).forEach(row => {
        if (row.booking_date && row.time_slot && row.court) {
          bookedMap.set(`${row.booking_date}|${row.time_slot}|${row.court}`, row);
        }
      });

      const conflicts = entries.filter(entry => {
        const key = `${entry.booking_date}|${entry.booking_time}|${entry.court}`;
        return bookedMap.has(key);
      }).map(entry => ({
        booking_date: entry.booking_date,
        booking_time: entry.booking_time,
        court: entry.court
      }));

      return { ok: conflicts.length === 0, conflicts };
    } catch (err) {
      console.error('checkSlotAvailability error:', err);
      return { ok: false, conflicts: [], error: err };
    }
  }

  window.verifyReceipt = async function() {
    if (!receiptFile) {
      showToast('Upload the receipt screenshot first.');
      return;
    }
    const parsed = getParsedReceiptData();
    const receiptReference = parsed.reference;
    const receiptAmount = parsed.amount;
    const mismatchEl = document.getElementById('receiptMismatch');
    
    // Determine whether this booking already exists in Supabase (from search or earlier save)
    const isExistingBooking = Boolean(pendingBookingEntries[0]?.fromExistingBooking || pendingBookingEntries[0]?.persistedInDb);
    
    console.log('Parsed receipt data:', { receiptReference, receiptAmount, receiptBookingTotal: receiptBookingTotal });
    console.log('Full booking entry:', JSON.stringify(pendingBookingEntries[0], null, 2));
    console.log('Reference code from entry:', pendingBookingEntries[0]?.reference_code);
    console.log('Is existing booking?', isExistingBooking);
    
    if (!receiptReference) {
      if (mismatchEl) mismatchEl.textContent = 'Receipt reference could not be detected from the image. Please try a clearer photo.';
      return;
    }
    if (receiptAmount == null) {
      if (mismatchEl) mismatchEl.textContent = 'Receipt amount could not be detected from the image. Please try a clearer photo.';
      return;
    }
    if (Number(receiptAmount.toFixed(2)) !== Number(receiptBookingTotal.toFixed(2))) {
      if (mismatchEl) mismatchEl.textContent = 'Receipt total amount does not match the booking total.';
      return;
    }

    if (!pendingBookingEntries || pendingBookingEntries.length === 0) {
      showToast('Booking data is missing. Please restart the booking process.');
      return;
    }

    if (!isExistingBooking) {
      const slotCheck = await checkSlotAvailability(pendingBookingEntries);
      if (!slotCheck.ok) {
        const conflictText = slotCheck.conflicts.length > 0
          ? slotCheck.conflicts.map(conflict => `${conflict.court} ${conflict.booking_date} ${conflict.booking_time}`).join('; ')
          : 'Could not verify slot availability.';
        const message = slotCheck.conflicts.length > 0
          ? `One or more selected slots were already booked: ${conflictText}. Please refresh and choose a different slot.`
          : 'Could not verify slot availability. Please try again.';
        if (mismatchEl) mismatchEl.textContent = message;
        showToast(message);
        return;
      }
    }

    // Check if receipt reference already exists in database to prevent duplicates
    try {
      const checkResult = await callBackendAPI('check-duplicate-receipt', { 
        receipt_reference: parsed.reference 
      });
      
      if (checkResult.exists) {
        if (mismatchEl) mismatchEl.textContent = 'This receipt has already been used. Duplicate booking not allowed.';
        showToast('Duplicate receipt detected. This receipt already exists in the system.');
        return;
      }
    } catch (err) {
      console.error('Error checking for duplicate receipt:', err);
      if (mismatchEl) mismatchEl.textContent = 'Error checking receipt. Please try again.';
      return;
    }

    // Check if this is an existing booking (from database search) or a new booking
    // (isExistingBooking already declared above for slot availability check)
    
    let updateError = null;
    try {
      if (isExistingBooking) {
        // Update existing booking with receipt - stays pending until admin confirms
        const result = await callBackendAPI('update-booking-receipt', {
          reference_code: pendingBookingEntries[0].reference_code,
          receipt_reference: parsed.reference,
          status: 'pending'
        });
        console.log('Update receipt API response:', result);
        if (!result.success) {
          updateError = new Error(result.error || 'Failed to update booking');
        }
      } else {
        // Insert new booking
        const bookingsToInsert = pendingBookingEntries.map(entry => ({
          booking_date: entry.booking_date,
          booking_time: entry.booking_time,
          time_slot: entry.time_slot,
          court: entry.court,
          court_name: entry.court_name,
          customer_name: entry.customer_name,
          phone_number: entry.phone_number,
          reference_code: entry.reference_code,
          receipt_reference: parsed.reference,
          status: 'pending',
          price: entry.price,
          rate: entry.rate,
          notes: entry.notes
        }));
        console.log('Inserting new bookings:', bookingsToInsert);
        const result = await callBackendAPI('bulk-insert-bookings', { bookings: bookingsToInsert });
        console.log('Insert bookings API response:', result);
        if (!result.success) {
          updateError = new Error(result.error || 'Failed to insert bookings');
        }
      }
    } catch (err) {
      updateError = err;
    }

    if (updateError) {
      console.error('Receipt verification error:', updateError);
      console.error('API error body:', updateError?.body);
      console.error('Error details:', JSON.stringify(updateError, null, 2));
      const errorText = updateError?.body?.message || updateError?.message || updateError?.body?.error || updateError?.error_description || updateError?.details || JSON.stringify(updateError);
      const errorMsg = String(errorText || 'Unknown database error');
      let userMessage = `Booking update failed: ${errorMsg}`;

      if (mismatchEl) mismatchEl.textContent = userMessage;
      showToast(userMessage);

      await loadAndRenderTable();
      return;
    }

    console.log('Receipt verification successful:', { referenceCode: receiptBookingReference, parsed });

    // No server-side email sending configured in this build.

    const entriesToRender = [...pendingBookingEntries];
    
    // For existing bookings (already in database), skip pending slot marking
    // For new bookings, mark slots as pending with 30-minute timer
    if (!isExistingBooking) {
      entriesToRender.forEach(entry => {
        const courtIndex = COURTS.indexOf(entry.court_name || entry.court);
        const key = `${entry.booking_date}|${entry.booking_time || entry.time_slot}|${courtIndex}`;
        pendingSlotsWithTimer[key] = Date.now(); // 30-minute pending timer
      });
      startPendingPoll();
    }

    const successName = entriesToRender[0]?.customer_name || '';
    const successCourt = entriesToRender[0]?.court_name || entriesToRender[0]?.court || '';
    const successDate = entriesToRender[0]?.booking_date ? formatDateDisplay(entriesToRender[0].booking_date) : '';
    const successTime = entriesToRender[0]?.booking_time || entriesToRender[0]?.time_slot || '';
    const successPaidTotal = `₱${entriesToRender.reduce((sum, entry) => sum + (entry.price || entry.rate || 0), 0).toLocaleString()}`;

    pendingBookingEntries = [];
    selectedSlots.clear();
    updateCart();
    await loadAndRenderTable();

    closeReceiptModal();
    closeModal(); // Close the search booking modal as well
    document.getElementById('successTitle').textContent = 'Booking Submitted';
    document.getElementById('successMessage').textContent = isExistingBooking 
      ? `Receipt uploaded for ${receiptBookingReference}. Awaiting admin approval.`
      : `Booking submitted for ${receiptBookingReference}. Awaiting admin approval.`;
    document.getElementById('successName').textContent = successName;
    const successCourtEl = document.getElementById('successCourt');
    const successDateEl = document.getElementById('successDate');
    const successTimeEl = document.getElementById('successTime');
    const successPaidTotalEl = document.getElementById('successPaidTotal');
    const scanTitleAmountEl = document.getElementById('scanTitleAmount');
    const bookingRefCodeEl = document.getElementById('bookingRefCode');

    if (successCourtEl) successCourtEl.textContent = successCourt;
    if (successDateEl) successDateEl.textContent = successDate;
    if (successTimeEl) successTimeEl.textContent = successTime;
    if (successPaidTotalEl) successPaidTotalEl.textContent = successPaidTotal;
    if (scanTitleAmountEl) scanTitleAmountEl.textContent = successPaidTotal;
    if (bookingRefCodeEl) bookingRefCodeEl.textContent = receiptBookingReference;
    renderSuccessBookingItems(entriesToRender);
    document.getElementById('successModal').classList.add('open');
    bookingSubmissionTime = Date.now();
    receiptRefUploaded = true;
    updateSuccessReceiptUploadState();
    const statusNote = document.getElementById('receiptUploadedStatus');
    if (statusNote) {
      statusNote.style.display = 'block';
    }
  };

  // Close modal on overlay click
  document.getElementById('bookingModal').onclick = function(e) {
    if (e.target === this) closeModal();
  };
  document.getElementById('successModal').onclick = function(e) {
    if (e.target === this) closeSuccessModal();
  };

  // Initialize
  renderCalendar();
  loadAndRenderTable();

  // Track booking submission time for timer
  let bookingSubmissionTime = null;
  // Polling interval id for checking backend confirmations of pending slots
  let pendingPollInterval = null;

  function startPendingPoll() {
    if (pendingPollInterval) return;
    pendingPollInterval = setInterval(async () => {
      if (Object.keys(pendingSlotsWithTimer).length === 0) {
        clearInterval(pendingPollInterval);
        pendingPollInterval = null;
        return;
      }
      try {
        await loadAndRenderTable();
      } catch (e) {
        console.error('Pending poll load failed', e);
      }
    }, 5000); // poll every 5s while pending slots exist
  }

  // Update timer display every second
  setInterval(() => {
    const now = Date.now();
    const thirtyMins = 60 * 60 * 1000;
    const fifteenMins = 15 * 60 * 1000;
    let expiredPendingSlots = false;
    
    // Update pending slots timer (30 minutes)
    Object.keys(pendingSlotsWithTimer).forEach(key => {
      if (now - pendingSlotsWithTimer[key] >= thirtyMins) {
        delete pendingSlotsWithTimer[key];
        expiredPendingSlots = true;
      }
    });

    // Re-render when pending slots are still counting down or when an expiry just occurred.
    if (expiredPendingSlots || Object.keys(pendingSlotsWithTimer).length > 0) {
      renderTable();
    }

    // Update payment/booking modal timer (15 minutes) if modal is open
    if (bookingSubmissionTime) {
      const elapsed = now - bookingSubmissionTime;
      const remaining = fifteenMins - elapsed;
      
      if (remaining <= 0) {
        const expiryEl = document.getElementById('successExpiryNote');
        if (expiryEl) expiryEl.textContent = 'Payment window expired - booking requires re-submission';
        bookingSubmissionTime = null;
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const expiryEl = document.getElementById('successExpiryNote');
        if (expiryEl) {
          expiryEl.textContent = `Expires in ${mins}:${secs.toString().padStart(2, '0')}`;
        }
      }
    }
  }, 1000);
});
