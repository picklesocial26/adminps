// admin-dashboard.js
let supabaseClient = null;
let allBookings = [];
let filteredBookings = [];
let groupedBookings = [];
let currentPage = 1;
const itemsPerPage = 20;
let currentEditingBooking = null;
let selectedBookingIds = new Set();
let currentBookingDetailsGroup = null;
let calendarViewDate = new Date();
let selectedCalendarDate = null;
let blockedTimeSlots = [];
const adminLogsStorageKey = 'pickleAdminLogs';
const pendingNotificationState = {
  knownPendingIds: new Set(),
  hasInitialized: false,
  lastAlertAt: 0,
  cooldownMs: 10000
};
let pendingAlertAudioContext = null;
let leaderboardMode = 'monthly';

function toggleSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggle = document.querySelector('.menu-toggle');
  if (!sidebar || !overlay) return;
  const isOpen = sidebar.classList.toggle('open');
  overlay.classList.toggle('visible', isOpen);
  document.body.classList.toggle('sidebar-open', isOpen);
  if (toggle) toggle.setAttribute('aria-expanded', String(isOpen));
}

function closeSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggle = document.querySelector('.menu-toggle');
  if (!sidebar || !overlay) return;
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
  document.body.classList.remove('sidebar-open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function getCurrentAdmin() {
  try {
    const profile = sessionStorage.getItem('adminProfile') || localStorage.getItem('adminProfile');
    return profile ? JSON.parse(profile) : null;
  } catch (err) {
    console.error('Failed to read admin profile:', err);
    return null;
  }
}

function updateAdminProfileBadge() {
  const sidebarName = document.getElementById('sidebarAdminName');
  const sidebarAvatar = document.getElementById('sidebarAdminAvatar');
  const currentAdmin = getCurrentAdmin();
  const adminName = currentAdmin?.name || 'Unknown Admin';
  if (sidebarName) sidebarName.textContent = adminName;
  if (sidebarAvatar) sidebarAvatar.textContent = adminName.charAt(0).toUpperCase();
}

function getAdminLogs() {
  try {
    const saved = localStorage.getItem(adminLogsStorageKey);
    return saved ? JSON.parse(saved) : [];
  } catch (err) {
    console.error('Failed to load admin logs:', err);
    return [];
  }
}

async function requestPendingNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch (err) {
      console.warn('Notification permission request failed', err);
    }
  }
}

async function registerPendingBookingNotifications() {
  if (typeof window === 'undefined') return;

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('service-worker.js');
      
      if ('periodicSync' in registration) {
        try {
          await registration.periodicSync.register('check-pending-bookings', {
            minInterval: 5 * 60 * 1000
          });
        } catch (err) {
          if (err && err.name !== 'NotAllowedError') {
            console.warn('Periodic sync registration failed', err);
          }
        }
      }
      
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'PENDING_BOOKING_CHECK') {
            trackPendingBookingNotifications(event.data.bookings);
          }
        });
      }
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  }

  await requestPendingNotificationPermission();
  
  if ('wakeLock' in navigator && !document.hidden) {
    try {
      await navigator.wakeLock.request('screen');
    } catch (err) {
      if (err?.name !== 'NotAllowedError') {
        console.warn('Wake lock request failed', err);
      }
    }
  }
}

async function notifyPendingBookingOnDevice(title, body, count = 1) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission !== 'granted') {
    const permission = await requestPendingNotificationPermission();
    if (permission !== 'granted' && Notification.permission !== 'granted') return;
  }

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        icon: 'logo.jpeg',
        badge: 'logo.jpeg',
        tag: 'pending-booking',
        renotify: true,
        requireInteraction: false
      });

      if (typeof navigator.setAppBadge === 'function') {
        try {
          await navigator.setAppBadge(count);
        } catch (err) {
          console.warn('App badge update failed', err);
        }
      }
      return;
    }

    new Notification(title, { body, icon: 'logo.jpeg' });
  } catch (err) {
    console.warn('Unable to send device notification', err);
  }
}

function playPendingBookingSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!pendingAlertAudioContext) {
      pendingAlertAudioContext = new AudioContextClass();
    }

    const ctx = pendingAlertAudioContext;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (navigator.vibrate) {
      navigator.vibrate([180, 90, 180]);
    }

    const now = ctx.currentTime;
    const oscillator1 = ctx.createOscillator();
    const oscillator2 = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator1.type = 'triangle';
    oscillator1.frequency.setValueAtTime(1040, now);
    oscillator1.frequency.exponentialRampToValueAtTime(1480, now + 0.14);

    oscillator2.type = 'square';
    oscillator2.frequency.setValueAtTime(1560, now + 0.05);
    oscillator2.frequency.exponentialRampToValueAtTime(1880, now + 0.16);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    oscillator1.connect(gain);
    oscillator2.connect(gain);
    gain.connect(ctx.destination);

    oscillator1.start(now);
    oscillator2.start(now);
    oscillator1.stop(now + 0.34);
    oscillator2.stop(now + 0.34);
  } catch (err) {
    console.warn('Unable to play pending booking sound', err);
  }
}

function showPendingBookingAlert(newPendingBookings = []) {
  if (!newPendingBookings.length) return;

  const latest = newPendingBookings[0] || {};
  const customerName = latest.customer_name || 'A customer';
  const phone = formatPhone(latest.phone_number || latest.phone || 'N/A');
  const bookingDate = latest.booking_date || 'soon';
  const bookingTime = latest.time_slot || latest.booking_time || '';
  const summary = newPendingBookings.length === 1
    ? `${customerName} • ${phone} • ${bookingDate}${bookingTime ? ` • ${bookingTime}` : ''}`
    : `${newPendingBookings.length} new pending bookings. Latest: ${customerName} • ${phone}`;

  const alertBox = document.getElementById('pendingBookingAlert');
  const alertMessage = document.getElementById('pendingBookingAlertMessage');

  if (alertBox && alertMessage) {
    alertMessage.textContent = summary;
    alertBox.classList.add('show');
    clearTimeout(showPendingBookingAlert.hideTimer);
    showPendingBookingAlert.hideTimer = setTimeout(() => {
      alertBox.classList.remove('show');
    }, 6000);
  }

  showToast(`New pending booking: ${customerName} • ${phone}`);
  playPendingBookingSound();

  const notificationBody = `${customerName} • ${phone} • ${bookingDate} • Check it now!`;
  notifyPendingBookingOnDevice('New Pending Booking', notificationBody, newPendingBookings.length);

  const originalTitle = document.title;
  document.title = 'New Pending Booking • Admin Dashboard';
  setTimeout(() => {
    document.title = originalTitle;
  }, 6000);
}

showPendingBookingAlert.hideTimer = null;

function scrollToPendingBookings(event) {
  if (event) event.stopPropagation();
  const bookingsSection = document.querySelector('.bookings-section');
  if (bookingsSection) {
    bookingsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function trackPendingBookingNotifications(bookings = []) {
  const pendingBookings = (bookings || []).filter(booking => (booking.status || '').toLowerCase() === 'pending');
  const currentIds = new Set(pendingBookings.map(booking => booking.id));

  if (!pendingNotificationState.hasInitialized) {
    pendingNotificationState.knownPendingIds = currentIds;
    pendingNotificationState.hasInitialized = true;
    return;
  }

  const newPendingBookings = pendingBookings.filter(booking => !pendingNotificationState.knownPendingIds.has(booking.id));
  pendingNotificationState.knownPendingIds = currentIds;

  const now = Date.now();
  if (newPendingBookings.length && now - pendingNotificationState.lastAlertAt >= pendingNotificationState.cooldownMs) {
    pendingNotificationState.lastAlertAt = now;
    showPendingBookingAlert(newPendingBookings);
  }
}

function saveAdminLogs(logs) {
  try {
    localStorage.setItem(adminLogsStorageKey, JSON.stringify(logs));
  } catch (err) {
    console.error('Failed to save admin logs:', err);
  }
}

function buildBookingLogDetails(booking = {}) {
  const parts = [];
  if (booking.reference_code) parts.push(`Reference: ${booking.reference_code}`);
  if (booking.customer_name) parts.push(`Customer: ${booking.customer_name}`);
  if (booking.booking_date) parts.push(`Booking Date: ${booking.booking_date}`);
  if (booking.booking_time || booking.time_slot) parts.push(`Booking Time: ${booking.booking_time || booking.time_slot}`);
  if (booking.court || booking.court_name) parts.push(`Court: ${booking.court || booking.court_name}`);
  if (booking.price || booking.rate) parts.push(`Amount: ₱${Number(booking.price || booking.rate || 0).toLocaleString()}`);
  return parts.length ? parts.join(' • ') : 'No booking details available.';
}

async function saveAdminLogToSupabase(entry) {
  if (!supabaseClient) return false;

  const payload = {
    type: entry.type,
    title: entry.title,
    details: entry.details,
    reference_code: entry.reference_code || null,
    customer_name: entry.customer_name || null,
    booking_id: entry.bookingId || entry.booking_id || null,
    created_at: entry.createdAt
  };

  const { error } = await supabaseClient.from('admin_logs').insert(payload);
  if (error) {
    console.error('Failed to save admin log to Supabase:', error);
    return false;
  }

  return true;
}

async function addAdminLog(type, title, details, payload = {}) {
  const currentAdmin = getCurrentAdmin();
  const actorName = currentAdmin?.name || 'Unknown Admin';
  const actorPrefix = `Action by ${actorName}. `;

  let serializedDetails = `${actorPrefix}${details}`;
  if (payload.bookings && Array.isArray(payload.bookings)) {
    serializedDetails = JSON.stringify({
      summary: `${actorPrefix}${details}`,
      bookings: payload.bookings
    });
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    details: serializedDetails,
    createdAt: new Date().toISOString(),
    actor_name: actorName,
    ...payload
  };

  const logs = [entry, ...getAdminLogs()].slice(0, 200);
  saveAdminLogs(logs);
  await saveAdminLogToSupabase(entry);
  return entry;
}

function getBookingGroupKey(booking) {
  if (booking.reference_code) return booking.reference_code;
  return `${booking.customer_name || 'unknown'}|${booking.phone_number || booking.phone || 'unknown'}|${booking.booking_date || ''}`;
}

function groupBookings(bookings) {
  const groups = {};

  bookings.forEach(booking => {
    const key = getBookingGroupKey(booking);
    if (!groups[key]) {
      groups[key] = {
        key,
        ids: [],
        bookings: [],
        reference_code: booking.reference_code || 'N/A',
        customer_name: booking.customer_name || 'N/A',
        phone_number: booking.phone_number || booking.phone || 'N/A',
        totalAmount: 0,
        status: booking.status || 'pending',
        courts: new Set(),
        dates: new Set(),
        times: new Set(),
        createdAt: null,
        bookedOn: 'N/A'
      };
    }

    const group = groups[key];
    group.ids.push(booking.id);
    group.bookings.push(booking);
    group.totalAmount += (booking.price || booking.rate || 0);
    group.courts.add(booking.court || booking.court_name || 'N/A');
    group.dates.add(booking.booking_date || 'N/A');
    group.times.add(booking.time_slot || booking.booking_time || 'N/A');

    const createdAtValue = booking.created_at || booking.createdAt || null;
    if (createdAtValue) {
      const createdAtDate = new Date(createdAtValue);
      if (!isNaN(createdAtDate.getTime())) {
        if (!group.createdAt || createdAtDate < group.createdAt) {
          group.createdAt = createdAtDate;
        }
      }
    }

    if (group.status !== 'pending') {
      if (booking.status === 'pending') {
        group.status = 'pending';
      } else if (booking.status === 'paid') {
        group.status = 'paid';
      }
    }
  });

  return Object.values(groups).map(group => {
    group.courtSummary = group.courts.size === 1 ? Array.from(group.courts)[0] : 'See details';
    group.dateSummary = group.dates.size === 1 ? Array.from(group.dates)[0] : 'See details';
    group.timeSummary = group.times.size === 1 ? Array.from(group.times)[0] : 'See details';
    group.bookedOn = group.createdAt ? formatDateTime(group.createdAt) : 'N/A';
    group.status = group.bookings.some(b => b.status === 'pending') ? 'pending' : group.bookings.some(b => b.status === 'paid') ? 'paid' : group.bookings[0]?.status || 'pending';
    return group;
  });
}

function parseSlotStartDateTime(bookingDate, timeSlot) {
  if (!bookingDate) return null;
  const datePart = bookingDate.trim();
  let timePart = '';

  if (typeof timeSlot === 'string' && timeSlot.trim()) {
    // Use the first range token as the start time, e.g. "1:00 PM - 2:00 PM"
    timePart = timeSlot.split('-')[0].trim();
  }

  if (!timePart) {
    const fallback = new Date(`${datePart}T00:00:00`);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  const match = timePart.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;

  const bookingDateTime = new Date(`${datePart}T00:00:00`);
  if (isNaN(bookingDateTime.getTime())) return null;
  bookingDateTime.setHours(hours, minutes, 0, 0);
  return bookingDateTime;
}

// Check authentication
function checkAuthentication() {
  const token = sessionStorage.getItem('adminToken') || localStorage.getItem('adminToken');
  const profile = sessionStorage.getItem('adminProfile') || localStorage.getItem('adminProfile');
  if (!token || !profile) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check if user is authenticated
  if (!checkAuthentication()) {
    return;
  }
  // Initialize Supabase
  const supabaseConfig = window.SUPABASE_CONFIG || {};
  const SUPABASE_URL = supabaseConfig.url || "https://nozisfmqzkeywefrqkok.supabase.co";
  const SUPABASE_ANON_KEY = supabaseConfig.anonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vemlzZm1xemtleXdlZnJxa29rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NzY2NzcsImV4cCI6MjA5NDE1MjY3N30.9CyqA4zZ9o5glyVl40Baah9ce-mqPIB3fAi2wp2-Ppk";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    showToast('Supabase configuration missing. Please set window.SUPABASE_CONFIG.');
    return;
  }

  try {
    updateAdminProfileBadge();
    await registerPendingBookingNotifications();
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    // Test connection
    const { error } = await supabaseClient.from("bookings").select("id").limit(1);
    if (error) throw error;
    
    showToast('Connected to database');
    
    // Set today's date as default range filter (local timezone, no UTC conversion)
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    const dateFrom = document.getElementById('filterFrom');
    const dateTo = document.getElementById('filterTo');
    if (dateFrom) dateFrom.value = dateString;
    if (dateTo) dateTo.value = dateString;
    
    // Load initial data
    await loadBookings();
    updateEarnings();

    const refreshPendingBookings = async () => {
      if (!supabaseClient) return;

      try {
        const { data, error } = await supabaseClient
          .from('bookings')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const bookingsData = data || [];
        trackPendingBookingNotifications(bookingsData);

        const previousSnapshot = JSON.stringify(allBookings);
        const nextSnapshot = JSON.stringify(bookingsData);
        if (previousSnapshot !== nextSnapshot) {
          allBookings = bookingsData;
          applyFilters();
          refreshCalendarView();
        }
      } catch (err) {
        console.error('Background booking refresh failed:', err);
      }
    };

    // Prevent PWA from being suspended when backgrounded
    if ('wakeLock' in navigator) {
      document.addEventListener('visibilitychange', async () => {
        if (!document.hidden && 'wakeLock' in navigator) {
          try {
            await navigator.wakeLock.request('screen');
          } catch (err) {
            if (err?.name !== 'NotAllowedError') {
              console.warn('Wake lock renewal failed', err);
            }
          }
        }
      });
    }

    // Instant refresh when PWA comes back to foreground
    window.addEventListener('focus', () => {
      refreshPendingBookings();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshPendingBookings();
      }
    });

    // Aggressive polling every 2 seconds
    setInterval(refreshPendingBookings, 2000);
  } catch (err) {
    console.error('Initialization error:', err);
    showToast('Failed to connect to database');
  }
});

// Load all bookings from Supabase
async function loadBookings() {
  if (!supabaseClient) {
    showToast('Database not connected');
    return;
  }

  try {
    // Show loading state
    const tbody = document.getElementById('bookingsTableBody');
    tbody.innerHTML = '<tr><td colspan="11" class="loading-cell">Loading bookings...</td></tr>';

    // Fetch all bookings
    const { data, error } = await supabaseClient
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const bookingsData = data || [];
    const expiredUpdated = await updateExpiredBookings(bookingsData);
    if (expiredUpdated) {
      await loadBookings();
      return;
    }

    allBookings = bookingsData;
    selectedBookingIds.clear();
    trackPendingBookingNotifications(bookingsData);

    applyFilters();
    refreshCalendarView();
  } catch (err) {
    console.error('Error loading bookings:', err);
    showToast('Failed to load bookings');
  }
}

// Check if a booking has expired and update status if needed
async function updateExpiredBookings(bookings) {
  try {
    const now = new Date();
    const expiredIds = [];

    for (const booking of bookings) {
      // Only check pending bookings
      if (booking.status !== 'pending') continue;

      let shouldExpire = false;

      if (booking.created_at) {
        const createdAt = new Date(booking.created_at);
        if (!isNaN(createdAt.getTime())) {
          const pendingTimeout = 60 * 60 * 1000; // 60 minutes
          if (now - createdAt >= pendingTimeout) {
            shouldExpire = true;
          }
        }
      }

      if (!shouldExpire) {
        const bookingDate = booking.booking_date;
        const timeSlot = booking.time_slot || booking.booking_time || '';

        if (!bookingDate) continue;

        const bookingDateTime = parseSlotStartDateTime(bookingDate, timeSlot);
        if (bookingDateTime && bookingDateTime < now) {
          shouldExpire = true;
        } else if (!bookingDateTime) {
          // If we cannot parse a valid time, still expire after 60 mins from creation
          // This is handled above by creation time, so do nothing here.
        }
      }

      if (shouldExpire) {
        expiredIds.push(booking.id);
      }
    }

    // Update all expired bookings in database
    if (expiredIds.length > 0) {
      const { error } = await supabaseClient
        .from('bookings')
        .update({ status: 'expired' })
        .in('id', expiredIds);

      if (error) {
        console.error('Error updating expired bookings:', error);
      } else {
        console.log(`Updated ${expiredIds.length} bookings to expired status`);
        // Expired bookings are only shown on dashboard, not logged
        return true;
      }
    }
  } catch (err) {
    console.error('Error checking for expired bookings:', err);
  }
  return false;
}

// Apply filters and render table
function applyFilters() {
  const searchInput = document.getElementById('searchInput');
  const courtFilterInput = document.getElementById('courtFilter');
  const statusFilterInput = document.getElementById('filterStatus');
  const dateFromInput = document.getElementById('filterFrom');
  const dateToInput = document.getElementById('filterTo');

  const searchTerm = (searchInput?.value || '').trim().toLowerCase();
  const courtFilter = courtFilterInput?.value || '';
  const statusFilter = statusFilterInput?.value || '';
  const dateFrom = dateFromInput?.value || '';
  const dateTo = dateToInput?.value || '';

  filteredBookings = allBookings.filter(booking => {
    let matches = true;
    const searchValue = [booking.reference_code, booking.customer_name, booking.phone_number, booking.customer_email, booking.booking_date, booking.court, booking.court_name]
      .filter(Boolean)
      .join(' ').toLowerCase();

    if (searchTerm) {
      matches = matches && searchValue.includes(searchTerm);
    }

    if (courtFilter) {
      const courtName = booking.court || booking.court_name || '';
      matches = matches && courtName === courtFilter;
    }

    if (statusFilter) {
      matches = matches && booking.status === statusFilter;
    }

    if (dateFrom) {
      matches = matches && booking.booking_date >= dateFrom;
    }

    if (dateTo) {
      matches = matches && booking.booking_date <= dateTo;
    }

    return matches;
  });

  currentPage = 1;
  groupedBookings = groupBookings(filteredBookings);
  renderAdminLeaderboard();
  renderTable();
  updatePagination();
  updateEarnings();
}

function toggleLeaderboardCollapse() {
  const section = document.getElementById('adminLeaderboardSection');
  const button = document.getElementById('leaderboardToggleBtn');

  if (!section || !button) return;

  const isCollapsed = section.classList.toggle('collapsed');
  button.textContent = isCollapsed ? 'Show leaderboard' : 'Hide leaderboard';
  button.setAttribute('aria-expanded', String(!isCollapsed));
}

function setLeaderboardMode(mode) {
  leaderboardMode = mode === 'total' ? 'total' : 'monthly';
  const copy = document.getElementById('leaderboardModeCopy');
  const buttons = document.querySelectorAll('.leaderboard-filter-btn');

  buttons.forEach(button => {
    const isActive = button.dataset.leaderboardMode === leaderboardMode;
    button.classList.toggle('active', isActive);
  });

  if (copy) {
    copy.textContent = leaderboardMode === 'total'
      ? 'Top 6 admins overall by confirmed bookings.'
      : 'Top 6 admins this month by confirmed bookings.';
  }

  renderAdminLeaderboard();
}

function renderAdminLeaderboard() {
  const leaderboardList = document.getElementById('adminLeaderboardList');
  if (!leaderboardList) return;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const filteredBookings = (allBookings || []).filter(booking => {
    const confirmedAt = booking.confirmed_at || booking.confirmedAt;
    if (!confirmedAt) return false;

    const confirmedDate = new Date(confirmedAt);
    if (Number.isNaN(confirmedDate.getTime())) return false;

    if (leaderboardMode === 'monthly') {
      return confirmedDate.getMonth() === currentMonth && confirmedDate.getFullYear() === currentYear;
    }

    return true;
  });

  const leaderboardEntries = filteredBookings
    .map(booking => booking.confirmed_by || booking.confirmedBy)
    .filter(Boolean)
    .reduce((acc, adminName) => {
      const key = String(adminName).trim();
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

  const rankedAdmins = Object.entries(leaderboardEntries)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 6);

  leaderboardList.innerHTML = '';

  if (!rankedAdmins.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'leaderboard-empty';
    emptyState.textContent = leaderboardMode === 'total'
      ? 'No confirmed bookings yet for the leaderboard.'
      : 'Leaderboard will light up once bookings start getting confirmed this month.';
    leaderboardList.appendChild(emptyState);
    return;
  }

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'];

  rankedAdmins.forEach((admin, index) => {
    const item = document.createElement('div');
    item.className = `leaderboard-item rank-${index + 1}`;

    const rank = document.createElement('div');
    rank.className = 'leaderboard-rank';
    rank.textContent = medals[index] || `${index + 1}`;

    const body = document.createElement('div');
    body.className = 'leaderboard-body';

    const name = document.createElement('div');
    name.className = 'leaderboard-name';
    name.textContent = admin.name;

    const count = document.createElement('div');
    count.className = 'leaderboard-count';
    count.textContent = `${admin.count} confirmed${leaderboardMode === 'monthly' ? ' this month' : ''}`;

    body.appendChild(name);
    body.appendChild(count);
    item.appendChild(rank);
    item.appendChild(body);
    leaderboardList.appendChild(item);
  });
}

// Render table with pagination
function renderTable() {
  const tbody = document.getElementById('bookingsTableBody');
  tbody.innerHTML = '';

  if (groupedBookings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="loading-cell">No bookings found</td></tr>';
    return;
  }

  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageBookings = groupedBookings.slice(start, end);

  pageBookings.forEach(group => {
    const row = document.createElement('tr');

    const selectCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = group.ids.every(id => selectedBookingIds.has(id));
    checkbox.onchange = () => toggleGroupSelection(group);
    checkbox.className = 'row-checkbox';
    selectCell.appendChild(checkbox);

    const refCell = createCell(group.reference_code || 'N/A');
    const nameCell = createCell(group.customer_name || 'N/A');
    const phoneCell = createCell(formatPhone(group.phone_number || 'N/A'));
    const bookedOnCell = createCell(group.bookedOn || 'N/A');
    const courtCell = createCell(group.courtSummary || 'Multiple');
    const dateCell = createCell(group.dateSummary || 'Multiple');
    const timeCell = createCell(group.timeSummary || 'Multiple');

    const amountCell = document.createElement('td');
    amountCell.textContent = '₱' + group.totalAmount.toLocaleString();

    const statusCell = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge ${group.status || 'pending'}`;
    statusBadge.textContent = group.status || 'pending';
    statusCell.appendChild(statusBadge);

    const confirmedByCell = document.createElement('td');
    const confirmedValues = [...new Set((group.bookings || [])
      .map(booking => booking.confirmed_by || booking.confirmedBy)
      .filter(Boolean))];
    confirmedByCell.textContent = confirmedValues.length ? confirmedValues.join(', ') : '—';

    const actionCell = document.createElement('td');
    actionCell.className = 'action-buttons';

    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openEditModal(group.bookings[0]);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn';
    copyBtn.textContent = 'Copy Ref';
    copyBtn.onclick = () => copyToClipboard(group.reference_code);

    const detailsBtn = document.createElement('button');
    detailsBtn.className = 'action-btn details-btn';
    detailsBtn.textContent = 'Details';
    detailsBtn.onclick = () => openBookingDetails(group);

    actionCell.appendChild(editBtn);
    actionCell.appendChild(copyBtn);
    actionCell.appendChild(detailsBtn);
    if (group.status === 'pending' || group.status === 'expired') {
      if (group.status === 'pending') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'action-btn confirm-btn';
        confirmBtn.textContent = 'Confirm';
        confirmBtn.title = 'Confirm booking and send Messenger notification';
        confirmBtn.onclick = () => confirmBookingViaMessenger(group);
        actionCell.appendChild(confirmBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'action-btn delete-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.title = group.status === 'pending'
        ? 'Delete this pending booking group'
        : 'Delete this expired booking group';
      deleteBtn.onclick = () => deleteBookingGroup(group);
      actionCell.appendChild(deleteBtn);
    }

    row.appendChild(selectCell);
    row.appendChild(refCell);
    row.appendChild(nameCell);
    row.appendChild(phoneCell);
    row.appendChild(bookedOnCell);
    row.appendChild(courtCell);
    row.appendChild(dateCell);
    row.appendChild(timeCell);
    row.appendChild(amountCell);
    row.appendChild(statusCell);
    row.appendChild(confirmedByCell);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  });

  updateBulkActions();
}

function getNextBookingSlot(booking) {
  const date = booking.booking_date || booking.date;
  const time = booking.time_slot || booking.booking_time;
  const startMinutes = getSlotStartMinutes(time);
  if (!date || !Number.isFinite(startMinutes) || startMinutes >= 24 * 60) return null;

  const nextStartMinutes = startMinutes + 60;
  const nextEndMinutes = nextStartMinutes + 60;
  const formatTime = minutes => {
    const normalizedMinutes = minutes % (24 * 60);
    const hours = Math.floor(normalizedMinutes / 60);
    const minute = String(normalizedMinutes % 60).padStart(2, '0');
    const suffix = hours < 12 ? 'AM' : 'PM';
    const displayHour = hours % 12 || 12;
    return minute === '00' ? `${displayHour}${suffix}` : `${displayHour}:${minute}${suffix}`;
  };

  const nextDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(nextDate.getTime())) return null;
  if (nextStartMinutes >= 24 * 60) nextDate.setDate(nextDate.getDate() + 1);

  return {
    date: formatDateKey(nextDate),
    court: booking.court || booking.court_name || 'Court One',
    timeSlot: `${formatTime(nextStartMinutes)} - ${formatTime(nextEndMinutes)}`
  };
}

let extendBookingGroups = [];

function openExtendBookingModal() {
  const modal = document.getElementById('extendBookingModal');
  const customerSelect = document.getElementById('extendBookingCustomer');
  if (!modal || !customerSelect) return;

  const todayKey = formatDateKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDateKey(yesterday);
  extendBookingGroups = groupBookings(allBookings).filter(group => {
    const activeBookings = group.bookings.filter(booking =>
      !['cancelled', 'expired'].includes(String(booking.status || '').toLowerCase())
    );
    if (!activeBookings.length) return false;

    const latestBooking = [...activeBookings]
      .sort((a, b) => getSlotStartMinutes(a.time_slot || a.booking_time) - getSlotStartMinutes(b.time_slot || b.booking_time))
      .at(-1);
    const nextSlot = getNextBookingSlot(latestBooking);
    const hasYesterdayBooking = activeBookings.some(booking =>
      (booking.booking_date || booking.date || '') === yesterdayKey
    );
    return (nextSlot && nextSlot.date >= todayKey) || hasYesterdayBooking;
  });
  customerSelect.innerHTML = '';

  if (!extendBookingGroups.length) {
    customerSelect.innerHTML = '<option value="">No active bookings found</option>';
    modal.classList.add('open');
    return;
  }

  extendBookingGroups.forEach((group, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${group.customer_name} · ${group.reference_code}`;
    customerSelect.appendChild(option);
  });

  modal.classList.add('open');
  updateExtendBookingFields(true);
}

async function updateExtendBookingFields(resetDate = false) {
  const customerSelect = document.getElementById('extendBookingCustomer');
  const dateInput = document.getElementById('extendBookingDate');
  const courtSelect = document.getElementById('extendBookingCourt');
  const timeSelect = document.getElementById('extendBookingTime');
  const timePicker = document.getElementById('extendTimeSlotPicker');
  const group = extendBookingGroups[Number(customerSelect?.value)];
  if (!group || !dateInput || !courtSelect || !timeSelect || !timePicker) return;

  const source = [...group.bookings]
    .filter(booking => !['cancelled', 'expired'].includes(String(booking.status || '').toLowerCase()))
    .sort((a, b) => getSlotStartMinutes(a.time_slot || a.booking_time) - getSlotStartMinutes(b.time_slot || b.booking_time))
    .at(-1) || group.bookings[0];
  const nextSlot = getNextBookingSlot(source);
  const defaultDate = nextSlot?.date || source.booking_date || source.date || formatDateKey(new Date());
  if (resetDate || !dateInput.value) dateInput.value = defaultDate;

  const currentCourt = courtSelect.value;
  const courts = [...new Set(group.bookings.map(booking => booking.court || booking.court_name || 'Court One'))];
  courtSelect.innerHTML = courts.map(court => `<option value="${court}">${court}</option>`).join('');
  if (courts.includes(currentCourt)) {
    courtSelect.value = currentCourt;
  } else if (source.court || source.court_name) {
    courtSelect.value = source.court || source.court_name;
  }

  const { data: blockedSlots, error: blockedError } = await supabaseClient
    .from('blocked_time_slots')
    .select('time_slot')
    .eq('blocked_date', dateInput.value)
    .eq('court', courtSelect.value);
  if (blockedError) {
    console.error('Failed to load extension slot statuses:', blockedError);
  }

  const blockedTimes = new Set((blockedSlots || []).map(slot => getSlotStartMinutes(slot.time_slot)));
  const groupIds = new Set(group.bookings.map(booking => booking.id));
  const selectedDate = dateInput.value;
  const selectedCourt = courtSelect.value;
  const normalizedCourt = String(selectedCourt).trim().toLowerCase();
  timeSelect.innerHTML = '';
  timePicker.innerHTML = '';
  for (let hour = 0; hour < 24; hour++) {
    const option = document.createElement('option');
    const formatTime = minutes => {
      const normalizedMinutes = minutes % (24 * 60);
      const hours = Math.floor(normalizedMinutes / 60);
      const minute = String(normalizedMinutes % 60).padStart(2, '0');
      const suffix = hours < 12 ? 'AM' : 'PM';
      const displayHour = hours % 12 || 12;
      return minute === '00' ? `${displayHour}${suffix}` : `${displayHour}:${minute}${suffix}`;
    };
    const timeSlot = `${formatTime(hour * 60)} - ${formatTime((hour + 1) * 60)}`;
    const timeValue = getSlotStartMinutes(timeSlot);
    const matchingBookings = allBookings.filter(booking => {
      const status = String(booking.status || '').toLowerCase();
      return !groupIds.has(booking.id) &&
        !['cancelled', 'expired'].includes(status) &&
        (booking.booking_date || booking.date) === selectedDate &&
        String(booking.court || booking.court_name || 'Court One').trim().toLowerCase() === normalizedCourt &&
        getSlotStartMinutes(booking.time_slot || booking.booking_time) === timeValue;
    });
    const alreadyAdded = group.bookings.some(booking =>
      (booking.booking_date || booking.date) === selectedDate &&
      String(booking.court || booking.court_name || 'Court One').trim().toLowerCase() === normalizedCourt &&
      getSlotStartMinutes(booking.time_slot || booking.booking_time) === timeValue
    );
    const status = blockedTimes.has(timeValue)
      ? 'Blocked'
      : alreadyAdded
        ? 'Already added'
        : matchingBookings.some(booking => String(booking.status || '').toLowerCase() === 'pending')
          ? 'Pending'
          : matchingBookings.length
            ? 'Booked'
            : 'Available';

    option.value = timeSlot;
    option.textContent = `${timeSlot} · ${status}`;
    option.className = `slot-option slot-option-${status.toLowerCase().replace(/\s+/g, '-')}`;
    option.disabled = status !== 'Available';
    timeSelect.appendChild(option);

    const slotButton = document.createElement('button');
    slotButton.type = 'button';
    slotButton.className = `slot-picker-row ${status.toLowerCase().replace(/\s+/g, '-')}`;
    slotButton.setAttribute('role', 'option');
    slotButton.setAttribute('aria-label', `${timeSlot}, ${status}`);
    slotButton.disabled = option.disabled;
    slotButton.innerHTML = `<span class="slot-picker-time">${timeSlot}</span><span class="slot-picker-status">${status}</span><span class="slot-picker-check">${status === 'Available' ? '○' : '—'}</span>`;
    slotButton.onclick = () => {
      timeSelect.value = timeSlot;
      updateExtendSelectedSlotStatus();
      timePicker.querySelectorAll('.slot-picker-row').forEach(row => row.classList.remove('selected'));
      slotButton.classList.add('selected');
    };
    timePicker.appendChild(slotButton);
  }
  const defaultOption = nextSlot && [...timeSelect.options].find(option => option.value === nextSlot.timeSlot);
  if (defaultOption && !defaultOption.disabled) {
    timeSelect.value = nextSlot.timeSlot;
  }
  updateExtendSelectedSlotStatus();
  const selectedRow = [...timePicker.querySelectorAll('.slot-picker-row')].find(row => row.querySelector('.slot-picker-time')?.textContent === timeSelect.value);
  selectedRow?.classList.add('selected');
}

function updateExtendSelectedSlotStatus() {
  const timeSelect = document.getElementById('extendBookingTime');
  const statusDisplay = document.getElementById('extendSelectedSlotStatus');
  if (!timeSelect || !statusDisplay) return;

  const selectedOption = timeSelect.selectedOptions[0];
  if (!selectedOption) {
    statusDisplay.textContent = '';
    statusDisplay.className = 'selected-slot-status';
    return;
  }

  const statusMatch = selectedOption.textContent.match(/·\s*(Available|Booked|Pending|Blocked|Already added)$/);
  const status = statusMatch ? statusMatch[1] : 'Available';
  statusDisplay.textContent = `${selectedOption.value} · ${status}`;
  statusDisplay.className = `selected-slot-status ${status.toLowerCase().replace(/\s+/g, '-')}`;

  document.querySelectorAll('#extendTimeSlotPicker .slot-picker-row').forEach(row => {
    row.classList.toggle('selected', row.querySelector('.slot-picker-time')?.textContent === selectedOption.value);
  });
}

function closeExtendBookingModal() {
  document.getElementById('extendBookingModal')?.classList.remove('open');
}

async function submitExtendBooking() {
  const customerSelect = document.getElementById('extendBookingCustomer');
  const dateInput = document.getElementById('extendBookingDate');
  const courtSelect = document.getElementById('extendBookingCourt');
  const timeSelect = document.getElementById('extendBookingTime');
  const group = extendBookingGroups[Number(customerSelect?.value)];
  if (!group || !dateInput?.value || !courtSelect?.value || !timeSelect?.value) {
    showToast('Select a customer, date, court, and time');
    return;
  }
  if (timeSelect.selectedOptions[0]?.disabled) {
    showToast('Select an available time slot');
    return;
  }

  await extendBookingTime(group, {
    date: dateInput.value,
    court: courtSelect.value,
    timeSlot: timeSelect.value
  });
}

async function extendBookingTime(group, requestedSlot = null) {
  if (!supabaseClient || !group?.bookings?.length) {
    showToast('Database connection unavailable');
    return;
  }

  const source = [...group.bookings]
    .sort((a, b) => getSlotStartMinutes(a.time_slot || a.booking_time) - getSlotStartMinutes(b.time_slot || b.booking_time))
    .at(-1);
  const nextSlot = requestedSlot || getNextBookingSlot(source);
  if (!nextSlot) {
    showToast('This booking cannot be extended past 11:00 PM');
    return;
  }

  const alreadyInGroup = group.bookings.some(booking =>
    (booking.booking_date || booking.date) === nextSlot.date &&
    (booking.court || booking.court_name || 'Court One') === nextSlot.court &&
    getSlotStartMinutes(booking.time_slot || booking.booking_time) === getSlotStartMinutes(nextSlot.timeSlot)
  );
  if (alreadyInGroup) {
    showToast('This booking already includes the next hour');
    return;
  }

  const occupied = allBookings.some(booking => {
    const status = String(booking.status || '').toLowerCase();
    return booking.id !== source.id &&
      !['cancelled', 'expired'].includes(status) &&
      (booking.booking_date || booking.date) === nextSlot.date &&
      String(booking.court || booking.court_name || 'Court One').trim().toLowerCase() === String(nextSlot.court).trim().toLowerCase() &&
      getSlotStartMinutes(booking.time_slot || booking.booking_time) === getSlotStartMinutes(nextSlot.timeSlot);
  });
  if (occupied) {
    showToast('The next hour is already booked');
    return;
  }

  const { data: blockedSlots, error: blockedError } = await supabaseClient
    .from('blocked_time_slots')
    .select('court, time_slot')
    .eq('blocked_date', nextSlot.date)
    .eq('court', nextSlot.court);
  if (blockedError) {
    console.error('Failed to check blocked times:', blockedError);
    showToast('Could not check the next timeslot');
    return;
  }
  if ((blockedSlots || []).some(slot => getSlotStartMinutes(slot.time_slot) === getSlotStartMinutes(nextSlot.timeSlot))) {
    showToast('The next hour is blocked');
    return;
  }

  const confirmed = confirm(`Extend ${source.customer_name || 'this booking'} to ${nextSlot.timeSlot}?\n\nAdditional rate: ₱${getBookingRateForDate(nextSlot.date).toLocaleString()}`);
  if (!confirmed) return;

  const payload = { ...source };
  delete payload.id;
  payload.booking_date = nextSlot.date;
  payload.time_slot = nextSlot.timeSlot;
  payload.booking_time = nextSlot.timeSlot;
  payload.price = getBookingRateForDate(nextSlot.date);
  payload.rate = payload.price;
  payload.created_at = new Date().toISOString();

  try {
    const { error } = await supabaseClient.from('bookings').insert([payload]);
    if (error) throw error;

    await addAdminLog(
      'booking_extended',
      'Booking time extended',
      `Added ${nextSlot.timeSlot} for ${source.customer_name || 'booking'} at ${nextSlot.court}.`,
      { reference_code: source.reference_code, customer_name: source.customer_name, booking_date: nextSlot.date, booking_time: nextSlot.timeSlot }
    );
    showToast('Booking extended by 1 hour');
    await loadBookings();
  } catch (error) {
    console.error('Failed to extend booking:', error);
    showToast('Failed to extend booking');
  }
}

function toggleGroupSelection(group) {
  const allSelected = group.ids.every(id => selectedBookingIds.has(id));
  group.ids.forEach(id => {
    if (allSelected) {
      selectedBookingIds.delete(id);
    } else {
      selectedBookingIds.add(id);
    }
  });
  updateBulkActions();
  renderTable();
}

function createCell(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function toggleRowSelection(bookingId) {
  if (selectedBookingIds.has(bookingId)) {
    selectedBookingIds.delete(bookingId);
  } else {
    selectedBookingIds.add(bookingId);
  }
  updateBulkActions();
}

function updateBulkActions() {
  const bulkBar = document.getElementById('bulkActionsBar');
  const selectedCount = document.getElementById('selectedCount');
  const count = selectedBookingIds.size;
  selectedCount.textContent = `${count} selected`;
  bulkBar.style.display = count > 0 ? 'flex' : 'none';
}

function getSelectedBookings() {
  return allBookings.filter(booking => selectedBookingIds.has(booking.id));
}

async function setBookingsPending(ids) {
  if (!ids || ids.length === 0) {
    return { error: null };
  }

  const now = new Date().toISOString();
  const { error } = await supabaseClient
    .from('bookings')
    .update({ status: 'pending', created_at: now })
    .in('id', ids);

  return { error };
}

async function bulkMarkPending() {
  const selected = getSelectedBookings();
  if (selected.length === 0) {
    showToast('No bookings selected');
    return;
  }

  const confirmed = confirm(`Mark ${selected.length} booking(s) as pending and restart their timer?`);
  if (!confirmed) return;

  const ids = selected.map(b => b.id);
  const { error } = await setBookingsPending(ids);

  if (error) {
    console.error('Bulk mark pending error:', error);
    showToast('Failed to mark pending');
    return;
  }

  showToast('Bookings marked pending');
  selectedBookingIds.clear();
  await loadBookings();
}

async function bulkMarkPaid() {
  const selected = getSelectedBookings();
  if (selected.length === 0) {
    showToast('No bookings selected');
    return;
  }

  const confirmed = confirm(`Mark ${selected.length} booking(s) as paid?`);
  if (!confirmed) return;

  const ids = selected.map(b => b.id);
  const { error } = await supabaseClient
    .from('bookings')
    .update({ status: 'paid' })
    .in('id', ids);

  if (error) {
    console.error('Bulk mark paid error:', error);
    showToast('Failed to mark paid');
    return;
  }

  showToast('Bookings marked paid');
  selectedBookingIds.clear();
  await loadBookings();
}

async function bulkMarkUnpaid() {
  const selected = getSelectedBookings();
  if (selected.length === 0) {
    showToast('No bookings selected');
    return;
  }

  const confirmed = confirm(`Mark ${selected.length} booking(s) as unpaid?`);
  if (!confirmed) return;

  const ids = selected.map(b => b.id);
  const { error } = await supabaseClient
    .from('bookings')
    .update({ status: 'unpaid' })
    .in('id', ids);

  if (error) {
    console.error('Bulk mark unpaid error:', error);
    showToast('Failed to mark unpaid');
    return;
  }

  showToast('Bookings marked unpaid');
  selectedBookingIds.clear();
  await loadBookings();
}

async function bulkCancel() {
  const selected = getSelectedBookings();
  if (selected.length === 0) {
    showToast('No bookings selected');
    return;
  }

  const confirmed = confirm(`Cancel ${selected.length} booking(s)?`);
  if (!confirmed) return;

  const ids = selected.map(b => b.id);
  const { error } = await supabaseClient
    .from('bookings')
    .update({ status: 'cancelled' })
    .in('id', ids);

  if (error) {
    console.error('Bulk cancel error:', error);
    showToast('Failed to cancel');
    return;
  }

  showToast('Bookings cancelled');
  selectedBookingIds.clear();
  await loadBookings();
}

async function bulkDelete() {
  const selected = getSelectedBookings();
  if (selected.length === 0) {
    showToast(' No bookings selected for delete');
    return;
  }

  const confirmed = confirm(`Delete ${selected.length} booking(s)? This cannot be undone.`);
  if (!confirmed) return;

  const ids = selected.map(b => b.id);
  const { error } = await supabaseClient
    .from('bookings')
    .delete()
    .in('id', ids);

  if (error) {
    console.error('Bulk delete error:', error);
    showToast('Failed to delete selected bookings');
    return;
  }

  const selectedBookings = selected.filter(b => ids.includes(b.id));
  const bookingPayload = selectedBookings.map(booking => ({
    bookingId: booking.id,
    reference_code: booking.reference_code,
    customer_name: booking.customer_name,
    booking_date: booking.booking_date,
    booking_time: booking.booking_time || booking.time_slot,
    court: booking.court || booking.court_name,
    amount: booking.price || booking.rate
  }));

  await addAdminLog(
    'deleted',
    'Bulk bookings deleted',
    `Deleted ${selectedBookings.length} selected booking slot(s).`,
    {
      bookingIds: ids,
      bookings: bookingPayload,
      reference_code: selectedBookings[0]?.reference_code || null,
      customer_name: selectedBookings[0]?.customer_name || null,
      booking_date: selectedBookings[0]?.booking_date || null,
      booking_time: selectedBookings[0]?.booking_time || selectedBookings[0]?.time_slot || null,
      court: selectedBookings[0]?.court || selectedBookings[0]?.court_name || null,
      amount: selectedBookings[0]?.price || selectedBookings[0]?.rate || null
    }
  );
  showToast('Selected bookings deleted');
  selectedBookingIds.clear();
  await loadBookings();
}

function downloadCsv() {
  const earningsDateInput = document.getElementById('earningsDate');
  const dateFromInput = document.getElementById('filterFrom');
  const selectedDate = earningsDateInput?.value ? new Date(earningsDateInput.value) : (dateFromInput?.value ? new Date(dateFromInput.value) : new Date());

  const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const normalizeDate = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };

  const bookingsToExport = (Array.isArray(allBookings) ? allBookings : []).filter(b => {
    const bDate = normalizeDate(b.booking_date);
    return bDate && bDate >= monthStart && bDate <= monthEnd && b.status !== 'cancelled' && b.status !== 'unpaid';
  });

  if (bookingsToExport.length === 0) {
    showToast('No bookings to export for this month');
    return;
  }

  const totalEarn = bookingsToExport.reduce((sum, b) => sum + (parseFloat(b.price) || parseFloat(b.rate) || 0), 0);
  const formattedTotalEarn = `PHP ${totalEarn.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formattedReferenceDate = selectedDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const rows = [
    ['Monthly Earnings Export', ''],
    ['Reference Date', formattedReferenceDate],
    ['Total Book:', bookingsToExport.length],
    ['Total Earn:', formattedTotalEarn],
    [],
    ['Reference', 'Name', 'Phone', 'Email', 'Court', 'Date', 'Time', 'Amount', 'Payment Method', 'Transaction ID', 'Status', 'Notes']
  ];

  bookingsToExport.forEach(b => {
    rows.push([
      b.reference_code || '',
      b.customer_name || '',
      b.phone_number || '',
      b.customer_email || b.email || '',
      b.court || b.court_name || '',
      b.booking_date || '',
      b.time_slot || b.booking_time || '',
      b.price || b.rate || 0,
      b.payment_method || '',
      b.transaction_id || b.transaction || '',
      b.status || '',
      b.notes || ''
    ]);
  });

  if (typeof XLSX === 'undefined') {
    showToast('Excel export is unavailable. Please check the XLSX library load.');
    return;
  }

  const sheetData = [
    ['Monthly Earnings Export', ''],
    ['Reference Date', formattedReferenceDate],
    ['Total Book:', bookingsToExport.length],
    ['Total Earn:', formattedTotalEarn],
    [],
    ['Reference', 'Name', 'Phone', 'Email', 'Court', 'Date', 'Time', 'Amount', 'Payment Method', 'Transaction ID', 'Status', 'Notes']
  ];

  bookingsToExport.forEach(b => {
    sheetData.push([
      b.reference_code || '',
      b.customer_name || '',
      b.phone_number || '',
      b.customer_email || b.email || '',
      b.court || b.court_name || '',
      b.booking_date || '',
      b.time_slot || b.booking_time || '',
      parseFloat(b.price || b.rate || 0) || 0,
      b.payment_method || '',
      b.transaction_id || b.transaction || '',
      b.status || '',
      b.notes || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const styleCell = (address, style) => {
    const cell = ws[address];
    if (cell) cell.s = Object.assign({}, cell.s || {}, style);
  };

  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFFFF' } },
    fill: { fgColor: { rgb: 'FF4F81BD' } }
  };
  const summaryStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'FFF2F2F2' } }
  };

  ['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4', 'B4'].forEach(addr => styleCell(addr, summaryStyle));
  for (let col = 0; col < 12; col++) {
    styleCell(XLSX.utils.encode_cell({ c: col, r: 5 }), headerStyle);
  }

  const amountFormat = '#,##0.00';
  for (let row = 6; row < sheetData.length; row++) {
    const amountAddr = XLSX.utils.encode_cell({ c: 7, r: row });
    const amountCell = ws[amountAddr];
    if (amountCell) {
      amountCell.t = 'n';
      amountCell.z = amountFormat;
      amountCell.s = Object.assign({}, amountCell.s || {}, { numFmt: amountFormat });
    }
  }

  ws['!cols'] = [
    { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 24 }
  ];

  const monthName = selectedDate.toLocaleString('en-US', { month: 'long' });
  const year = selectedDate.getFullYear();
  const fileName = `${monthName} ${year} Monthly Booking Report.xlsx`;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, fileName);
  showToast('Monthly Excel export ready');
}

// Format phone number
function formatPhone(phone) {
  if (!phone) return 'N/A';
  // Remove non-digits
  const digits = phone.replace(/\D/g, '');
  // Format as +63 XXX XXX XXXX or show last 10 digits
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    return `+63 ${last10.substring(0, 3)} ${last10.substring(3, 6)} ${last10.substring(6)}`;
  }
  return phone;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!date || isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function getBookingTimeValue(timeValue) {
  if (!timeValue) return Number.MAX_SAFE_INTEGER;
  const rawValue = String(timeValue).trim().toUpperCase();
  const match = rawValue.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return Number.MAX_SAFE_INTEGER;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] || '0', 10);
  const meridiem = match[3];

  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

function getSlotStartMinutes(timeValue) {
  return getBookingTimeValue(String(timeValue || '').split('-')[0].trim());
}

function getBookingsForDate(dateKey) {
  return allBookings
    .filter(booking => (booking.booking_date || booking.date || '').toString() === dateKey)
    .sort((a, b) => {
      const timeA = getSlotStartMinutes(a.time_slot || a.booking_time || '');
      const timeB = getSlotStartMinutes(b.time_slot || b.booking_time || '');
      return timeA - timeB;
    });
}

function refreshCalendarView() {
  const modal = document.getElementById('calendarModal');
  if (modal && modal.classList.contains('open')) {
    renderScheduleModal();
  }
}

function getScheduleCourts() {
  return ['Court One', 'Training Court'];
}

function onScheduleDateChange(event) {
  const input = event.target;
  if (!input || !input.value) return;
  selectedCalendarDate = input.value;
  renderScheduleModal();
  loadBlockedTimesForSchedule();
}

function parseBookingHour(timeValue) {
  if (!timeValue) return null;
  const raw = String(timeValue).trim();
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minutes = parseInt(match[2] || '0', 10);
  const ampm = match[3] ? match[3].toUpperCase() : null;

  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  if (hour === 24) hour = 0;

  if (minutes >= 30) {
    // Still map to the slot start hour.
  }

  if (hour >= 0 && hour <= 23) {
    return hour;
  }
  return null;
}

function getBookingInitials(name) {
  if (!name) return '??';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function renderScheduleModal() {
  const grid = document.getElementById('scheduleGrid');
  const dateInput = document.getElementById('scheduleDateInput');
  const detailTitle = document.getElementById('scheduleDayDetailTitle');
  const detailSummary = document.getElementById('scheduleDayDetailSummary');
  const detailList = document.getElementById('scheduleDayDetailList');

  if (!grid || !dateInput || !detailTitle || !detailSummary || !detailList) return;

  const activeDate = selectedCalendarDate ? new Date(selectedCalendarDate) : new Date();
  if (isNaN(activeDate.getTime())) {
    selectedCalendarDate = formatDateKey(new Date());
  }

  dateInput.value = selectedCalendarDate;
  const courts = getScheduleCourts();

  const bookings = getBookingsForDate(selectedCalendarDate);
  const blockedByCourtHour = new Set(blockedTimeSlots.map(block => `${block.court}|${parseBookingHour(block.time_slot)}`));
  const bookingsByCourtHour = {};
  courts.forEach(court => { bookingsByCourtHour[court] = {}; });
  bookings.forEach(booking => {
    const courtName = booking.court || booking.court_name || 'Court';
    const hour = parseBookingHour(booking.time_slot || booking.booking_time || '');
    if (hour === null) return;
    const list = bookingsByCourtHour[courtName] || {};
    list[hour] = list[hour] || [];
    list[hour].push(booking);
    bookingsByCourtHour[courtName] = list;
  });

  grid.innerHTML = '';
  const headerRow = document.createElement('div');
  headerRow.className = 'schedule-row';
  const headerTime = document.createElement('div');
  headerTime.className = 'schedule-cell header';
  headerTime.textContent = 'Time';
  headerRow.appendChild(headerTime);
  courts.forEach(court => {
    const cell = document.createElement('div');
    cell.className = 'schedule-cell header';
    cell.textContent = court === 'Court One' ? 'Court 1' : 'Training Court - Coming Soon';
    headerRow.appendChild(cell);
  });
  grid.appendChild(headerRow);

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement('div');
    row.className = 'schedule-row';
    const timeCell = document.createElement('div');
    timeCell.className = 'schedule-cell time-label';
    timeCell.textContent = formatScheduleHour(hour);
    row.appendChild(timeCell);

    courts.forEach(court => {
      const slotCell = document.createElement('button');
      slotCell.type = 'button';
      slotCell.className = 'schedule-cell slot-cell';
      const slotBookings = bookingsByCourtHour[court]?.[hour] || [];
      if (court === 'Training Court') {
        slotCell.classList.add('slot-coming-soon');
        slotCell.innerHTML = '<span class="slot-subtitle">Coming Soon</span>';
      } else if (blockedByCourtHour.has(`${court}|${hour}`)) {
        slotCell.classList.add('slot-blocked');
        slotCell.innerHTML = '<span class="slot-initials">Blocked</span><span class="slot-subtitle">Unavailable</span>';
      } else if (slotBookings.length === 0) {
        slotCell.classList.add('slot-empty');
        slotCell.innerHTML = '<span class="slot-subtitle">Available</span>';
      } else {
        slotCell.classList.add('slot-booked');
        const initials = slotBookings.map(b => getBookingInitials(b.customer_name || b.customer || 'Guest')).join(', ');
        slotCell.innerHTML = `
          <div class="slot-initials">${initials}</div>
          <div class="slot-title">${slotBookings[0].customer_name || 'Booked'}</div>
          <div class="slot-subtitle">${slotBookings.length > 1 ? `${slotBookings.length} bookings` : (slotBookings[0].time_slot || slotBookings[0].booking_time || 'Booked')}</div>
        `;
      }
      slotCell.onclick = () => {
        selectedCalendarDate = formatDateKey(new Date(selectedCalendarDate));
        renderScheduleModal();
      };
      row.appendChild(slotCell);
    });

    grid.appendChild(row);
  }

  detailTitle.textContent = new Date(selectedCalendarDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  detailSummary.textContent = bookings.length === 0 ? 'No bookings' : `${bookings.length} booking${bookings.length === 1 ? '' : 's'}`;
  detailList.innerHTML = '';

  if (bookings.length === 0) {
    detailList.innerHTML = '<div class="empty-list">No bookings found for this day.</div>';
  } else {
    bookings.forEach(booking => {
      const item = document.createElement('div');
      item.className = 'calendar-detail-item';
      const info = document.createElement('div');
      info.innerHTML = `
        <strong>${booking.customer_name || 'Unknown'}</strong>
        <div class="calendar-detail-meta">${booking.court || booking.court_name || 'Court'} · ${booking.time_slot || booking.booking_time || 'TBD'}</div>
        <div class="calendar-detail-meta">Ref: ${booking.reference_code || 'N/A'} · ₱${(booking.price || booking.rate || 0).toLocaleString()}</div>
      `;
      const badge = document.createElement('span');
      badge.className = `status-badge ${booking.status || 'pending'}`;
      badge.textContent = booking.status || 'pending';
      item.appendChild(info);
      item.appendChild(badge);
      detailList.appendChild(item);
    });
  }
}

async function loadBlockedTimesForSchedule() {
  if (!supabaseClient || !selectedCalendarDate) return;
  const { data, error } = await supabaseClient
    .from('blocked_time_slots')
    .select('court, time_slot')
    .eq('blocked_date', selectedCalendarDate);
  if (error) {
    console.error('Failed to load schedule blocks:', error);
    return;
  }
  blockedTimeSlots = data || [];
  renderScheduleModal();
}

function formatScheduleHour(hour) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const endHour = (hour + 1) % 24;
  const endSuffix = endHour < 12 ? 'AM' : 'PM';
  const displayEnd = endHour % 12 === 0 ? 12 : endHour % 12;
  return `${displayHour}${suffix} - ${displayEnd}${endSuffix}`;
}

function openCalendarModal(date = new Date()) {
  selectedCalendarDate = formatDateKey(date);
  document.getElementById('calendarModal').classList.add('open');
  renderScheduleModal();
  loadBlockedTimesForSchedule();
}

function getBlockTimeOptions() {
  const options = [];
  for (let hour = 0; hour < 24; hour++) {
    options.push({ court: 'Court One', hour, time_slot: formatScheduleHour(hour) });
  }
  return options;
}

async function loadBlockTimesForDate() {
  const dateInput = document.getElementById('blockTimesDate');
  const optionsContainer = document.getElementById('blockTimesOptions');
  if (!dateInput || !optionsContainer || !dateInput.value) return;

  optionsContainer.innerHTML = '<div class="empty-list">Loading timeslots...</div>';
  const { data, error } = await supabaseClient
    .from('blocked_time_slots')
    .select('court, time_slot')
    .eq('blocked_date', dateInput.value);
  if (error) {
    console.error('Failed to load blocked times:', error);
    optionsContainer.innerHTML = '<div class="empty-list">Unable to load blocked timeslots.</div>';
    return;
  }

  blockedTimeSlots = data || [];
  const bookedKeys = new Set();
  getBookingsForDate(dateInput.value).forEach(booking => {
    const court = booking.court || booking.court_name || '';
    const hour = parseBookingHour(booking.time_slot || booking.booking_time);
    if (hour !== null) bookedKeys.add(`${court}|${hour}`);
  });
  optionsContainer.innerHTML = '';
  const courtOneColumn = document.createElement('div');
  courtOneColumn.className = 'block-time-court-column';
  courtOneColumn.innerHTML = '<h4>Court 1</h4>';
  const trainingColumn = document.createElement('div');
  trainingColumn.className = 'block-time-court-column training-court-column';
  trainingColumn.innerHTML = '<h4>Training Court</h4><div class="training-coming-soon">Coming Soon</div>';

  getBlockTimeOptions().forEach(option => {
    const isBooked = bookedKeys.has(`${option.court}|${option.hour}`);
    const isBlocked = blockedTimeSlots.some(block => block.court === option.court && parseBookingHour(block.time_slot) === option.hour);
    const label = document.createElement('label');
    label.className = `block-time-option${isBooked ? ' is-booked' : ''}`;
    label.innerHTML = `<input type="checkbox" value="${option.hour}" data-court="${option.court}"${isBlocked ? ' checked' : ''}${isBooked ? ' disabled' : ''}><span>${option.court} · ${option.time_slot}${isBooked ? ' · Booked' : ''}</span>`;
    courtOneColumn.appendChild(label);
  });
  optionsContainer.appendChild(courtOneColumn);
  optionsContainer.appendChild(trainingColumn);
}

function openBlockTimesModal() {
  const dateInput = document.getElementById('blockTimesDate');
  if (!dateInput) return;
  dateInput.value = selectedCalendarDate || formatDateKey(new Date());
  document.getElementById('blockTimesModal').classList.add('open');
  loadBlockTimesForDate();
}

function closeBlockTimesModal() {
  document.getElementById('blockTimesModal')?.classList.remove('open');
}

async function saveBlockedTimes() {
  const date = document.getElementById('blockTimesDate')?.value;
  const options = [...document.querySelectorAll('#blockTimesOptions input[type="checkbox"]:checked')];
  if (!date) return showToast('Select a date first');
  if (!supabaseClient) return showToast('Database connection unavailable');

  const selected = options.map(input => ({ blocked_date: date, court: input.dataset.court, time_slot: formatScheduleHour(Number(input.value)) }));
  const { error: deleteError } = await supabaseClient.from('blocked_time_slots').delete().eq('blocked_date', date);
  if (deleteError) {
    console.error('Failed to update blocked times:', deleteError);
    return showToast('Could not update blocked timeslots');
  }
  if (selected.length) {
    const { error } = await supabaseClient.from('blocked_time_slots').insert(selected);
    if (error) {
      console.error('Failed to save blocked times:', error);
      return showToast('Could not save blocked timeslots');
    }
  }
  blockedTimeSlots = selected;
  selectedCalendarDate = date;
  closeBlockTimesModal();
  renderScheduleModal();
  showToast(`${selected.length} timeslot${selected.length === 1 ? '' : 's'} blocked`);
}

function getExpiredBookings() {
  return (allBookings || []).filter(booking => String(booking.status || '').toLowerCase() === 'expired');
}

function openExpiredBookingsModal() {
  const modal = document.getElementById('expiredBookingsModal');
  if (!modal) return;
  renderExpiredBookings();
  modal.classList.add('open');
}

function closeExpiredBookingsModal() {
  document.getElementById('expiredBookingsModal')?.classList.remove('open');
}

function renderExpiredBookings() {
  const list = document.getElementById('expiredBookingList');
  const count = document.getElementById('expiredBookingsCount');
  const deleteAllButton = document.getElementById('deleteAllExpiredBtn');
  const summary = document.getElementById('expiredBookingsSummary');
  if (!list || !count || !deleteAllButton || !summary) return;

  const expiredBookings = getExpiredBookings();
  count.textContent = `${expiredBookings.length} expired slot${expiredBookings.length === 1 ? '' : 's'}`;
  deleteAllButton.disabled = expiredBookings.length === 0;
  summary.textContent = expiredBookings.length
    ? 'Delete expired slots manually when they are no longer needed.'
    : 'No expired bookings to review.';
  list.innerHTML = '';

  if (!expiredBookings.length) {
    list.innerHTML = '<div class="empty-list">No expired bookings found.</div>';
    return;
  }

  expiredBookings
    .slice()
    .sort((a, b) => String(b.booking_date || '').localeCompare(String(a.booking_date || '')))
    .forEach(booking => {
      const item = document.createElement('div');
      item.className = 'expired-booking-item';

      const details = document.createElement('div');
      details.className = 'expired-booking-details';
      const customer = document.createElement('strong');
      customer.textContent = booking.customer_name || 'Unknown customer';
      const meta = document.createElement('span');
      meta.textContent = `${booking.reference_code || 'No reference'} · ${booking.booking_date || 'No date'} · ${booking.time_slot || booking.booking_time || 'No time'} · ${booking.court || booking.court_name || 'Court'}`;
      details.append(customer, meta);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'action-btn delete-btn';
      deleteButton.textContent = 'Delete';
      deleteButton.onclick = () => deleteExpiredBooking(booking);
      item.append(details, deleteButton);
      list.appendChild(item);
    });
}

async function deleteExpiredBooking(booking) {
  if (!supabaseClient || !booking?.id) {
    showToast('Database connection unavailable');
    return;
  }
  const confirmed = confirm(`Delete expired booking for ${booking.customer_name || 'this customer'}?\n\n${booking.booking_date || ''} · ${booking.time_slot || booking.booking_time || ''}`);
  if (!confirmed) return;

  const { error } = await supabaseClient.from('bookings').delete().eq('id', booking.id);
  if (error) {
    console.error('Failed to delete expired booking:', error);
    showToast('Failed to delete expired booking');
    return;
  }

  await addAdminLog(
    'deleted',
    'Expired booking deleted',
    `Deleted expired booking ${booking.reference_code || booking.id} for ${booking.customer_name || 'Unknown customer'}.`,
    {
      bookingId: booking.id,
      reference_code: booking.reference_code,
      customer_name: booking.customer_name,
      booking_date: booking.booking_date,
      booking_time: booking.booking_time || booking.time_slot,
      court: booking.court || booking.court_name,
      amount: booking.price || booking.rate
    }
  );
  showToast('Expired booking deleted');
  await loadBookings();
  renderExpiredBookings();
}

async function deleteAllExpiredBookings() {
  const expiredBookings = getExpiredBookings();
  if (!expiredBookings.length || !supabaseClient) return;
  const confirmed = confirm(`Delete all ${expiredBookings.length} expired booking slots? This cannot be undone.`);
  if (!confirmed) return;

  const ids = expiredBookings.map(booking => booking.id).filter(Boolean);
  const { error } = await supabaseClient.from('bookings').delete().in('id', ids);
  if (error) {
    console.error('Failed to delete expired bookings:', error);
    showToast('Failed to delete expired bookings');
    return;
  }

  await addAdminLog('deleted', 'Expired bookings deleted', `Deleted ${ids.length} expired booking slot(s).`, {
    bookingIds: ids,
    bookings: expiredBookings.map(booking => ({
      bookingId: booking.id,
      reference_code: booking.reference_code,
      customer_name: booking.customer_name,
      booking_date: booking.booking_date,
      booking_time: booking.booking_time || booking.time_slot,
      court: booking.court || booking.court_name,
      amount: booking.price || booking.rate
    }))
  });
  showToast('Expired bookings deleted');
  await loadBookings();
  renderExpiredBookings();
}

function closeCalendarModal() {
  document.getElementById('calendarModal').classList.remove('open');
}

function changeScheduleDay(step) {
  const current = new Date(selectedCalendarDate || formatDateKey(new Date()));
  current.setDate(current.getDate() + step);
  selectedCalendarDate = formatDateKey(current);
  renderScheduleModal();
  loadBlockedTimesForSchedule();
}

function goToScheduleToday() {
  const today = new Date();
  selectedCalendarDate = formatDateKey(today);
  renderScheduleModal();
  loadBlockedTimesForSchedule();
}

// Update earnings cards
function updateEarnings() {
  // Use the earnings modal date if set, otherwise fallback to the filter date or today
  const earningsDateInput = document.getElementById('earningsDate');
  const dateFromInput = document.getElementById('filterFrom');
  let selectedDate;
  
  if (earningsDateInput?.value) {
    selectedDate = new Date(earningsDateInput.value);
  } else if (dateFromInput?.value) {
    selectedDate = new Date(dateFromInput.value);
  } else {
    selectedDate = new Date();
  }

  // Helper function to normalize date comparison
  const normalizeDate = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };

  const selectedDateNormalized = normalizeDate(formatDateKey(selectedDate));

  // Calculate the week range (Sunday to Saturday)
  const dayOfWeek = selectedDate.getDay();
  const weekStart = new Date(selectedDate);
  weekStart.setDate(selectedDate.getDate() - dayOfWeek); // Start from Sunday
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6); // End on Saturday

  // Calculate the month range (1st to last day)
  const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);

  // Use all bookings for earnings overview
  const bookingsToUse = allBookings;

  // Today's earnings - bookings on the selected date only
  const todayBookings = bookingsToUse.filter(b => {
    const bDate = normalizeDate(b.booking_date);
    return bDate && bDate.getTime() === selectedDateNormalized.getTime() && b.status !== 'cancelled' && b.status !== 'unpaid';
  });
  const todayEarnings = todayBookings.reduce((sum, b) => sum + (parseFloat(b.price) || parseFloat(b.rate) || 0), 0);

  // Weekly earnings - Sunday to Saturday of the selected week
  const weeklyBookings = bookingsToUse.filter(b => {
    const bDate = normalizeDate(b.booking_date);
    return bDate && bDate >= weekStart && bDate <= weekEnd && b.status !== 'cancelled' && b.status !== 'unpaid';
  });
  const weeklyEarnings = weeklyBookings.reduce((sum, b) => sum + (parseFloat(b.price) || parseFloat(b.rate) || 0), 0);

  // Monthly earnings - all bookings in the month
  const monthlyBookings = bookingsToUse.filter(b => {
    const bDate = normalizeDate(b.booking_date);
    return bDate && bDate >= monthStart && bDate <= monthEnd && b.status !== 'cancelled' && b.status !== 'unpaid';
  });
  const monthlyEarnings = monthlyBookings.reduce((sum, b) => sum + (parseFloat(b.price) || parseFloat(b.rate) || 0), 0);

  // Pending payments from all bookings
  const pendingBookings = bookingsToUse.filter(b => b.status === 'pending');
  const pendingAmount = pendingBookings.reduce((sum, b) => sum + (parseFloat(b.price) || parseFloat(b.rate) || 0), 0);

  // Update UI
  document.getElementById('todayEarnings').textContent = '₱' + todayEarnings.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  document.getElementById('todayCount').textContent = `${todayBookings.length} booking${todayBookings.length !== 1 ? 's' : ''}`;

  document.getElementById('weeklyEarnings').textContent = '₱' + weeklyEarnings.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  document.getElementById('weeklyCount').textContent = `${weeklyBookings.length} booking${weeklyBookings.length !== 1 ? 's' : ''}`;

  document.getElementById('monthlyEarnings').textContent = '₱' + monthlyEarnings.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  document.getElementById('monthlyCount').textContent = `${monthlyBookings.length} booking${monthlyBookings.length !== 1 ? 's' : ''}`;

  document.getElementById('pendingAmount').textContent = '₱' + pendingAmount.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  document.getElementById('pendingCount').textContent = `${pendingBookings.length} booking${pendingBookings.length !== 1 ? 's' : ''}`;
}

const earningsModalPassword = 'picklesocial26';

function openEarningsModalWithPassword() {
  const modal = document.getElementById('earningsPasswordModal');
  const input = document.getElementById('earningsPasswordInput');
  if (!modal || !input) {
    openEarningsModal();
    return;
  }

  input.value = '';
  modal.classList.add('open');
  setTimeout(() => input.focus(), 120);
}

function closeEarningsPasswordModal() {
  const modal = document.getElementById('earningsPasswordModal');
  if (modal) modal.classList.remove('open');
}

function submitEarningsPassword() {
  const input = document.getElementById('earningsPasswordInput');
  if (!input) return false;

  if (input.value.trim() === earningsModalPassword) {
    closeEarningsPasswordModal();
    openEarningsModal();
  } else {
    showToast('Incorrect password');
    input.value = '';
    input.focus();
  }

  return false;
}

function openEarningsModal() {
  const earningsDateInput = document.getElementById('earningsDate');
  if (earningsDateInput && !earningsDateInput.value) {
    earningsDateInput.value = formatDateKey(new Date());
  }
  updateEarnings();
  document.getElementById('earningsModal').classList.add('open');
}

function closeEarningsModal() {
  document.getElementById('earningsModal').classList.remove('open');
}

function openAddBookingModal() {
  const modal = document.getElementById('addBookingModal');
  if (!modal) return;

  const dateInput = document.getElementById('addBookingDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = formatDateKey(new Date());
  }

  const customerNameInput = document.getElementById('addBookingCustomerName');
  const phoneInput = document.getElementById('addBookingPhone');
  const timeInput = document.getElementById('addBookingTime');
  const courtSelect = document.getElementById('addBookingCourt');
  const statusSelect = document.getElementById('addBookingStatus');
  const notesInput = document.getElementById('addBookingNotes');

  if (customerNameInput) customerNameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (timeInput) timeInput.value = '';
  if (courtSelect) courtSelect.value = 'Court One';
  if (statusSelect) statusSelect.value = 'paid';
  if (notesInput) notesInput.value = '';

  updateAddBookingRate();
  modal.classList.add('open');
  setTimeout(() => customerNameInput?.focus(), 120);
}

function closeAddBookingModal() {
  const modal = document.getElementById('addBookingModal');
  if (modal) modal.classList.remove('open');
}

function updateAddBookingRate() {
  const dateInput = document.getElementById('addBookingDate');
  const rateValue = document.getElementById('addBookingRateValue');
  if (!dateInput || !rateValue) return;

  const rate = getBookingRateForDate(dateInput.value);
  rateValue.textContent = `₱${rate}`;
}

async function submitAddBooking() {
  if (!supabaseClient) {
    showToast('Database not connected');
    return;
  }

  const customerName = document.getElementById('addBookingCustomerName')?.value?.trim() || '';
  const phone = document.getElementById('addBookingPhone')?.value?.trim() || '';
  const bookingDate = document.getElementById('addBookingDate')?.value || '';
  const bookingTime = document.getElementById('addBookingTime')?.value || '';
  const timeSlot = bookingTime ? formatTimeInputValue(bookingTime) : '';
  const court = document.getElementById('addBookingCourt')?.value || '';
  const status = document.getElementById('addBookingStatus')?.value || 'paid';
  const notes = document.getElementById('addBookingNotes')?.value?.trim() || '';

  const missing = [];
  if (!customerName) missing.push('name');
  if (!phone) missing.push('phone');
  if (!bookingDate) missing.push('date');
  if (!timeSlot) missing.push('time');
  if (!court) missing.push('court');

  if (missing.length > 0) {
    showToast(`Please fill in ${missing.join(', ')}.`);
    return;
  }

  const price = getBookingRateForDate(bookingDate);
  const referenceCode = `PKL-${Date.now().toString(36).toUpperCase()}`;

  const payload = {
    reference_code: referenceCode,
    customer_name: customerName,
    phone_number: phone,
    booking_date: bookingDate,
    time_slot: timeSlot,
    booking_time: timeSlot,
    court,
    court_name: court,
    status,
    price,
    rate: price,
    notes: notes || null,
    created_at: new Date().toISOString()
  };

  try {
    const { error } = await supabaseClient.from('bookings').insert([payload]);
    if (error) throw error;

    showToast('Booking added successfully');
    closeAddBookingModal();
    await loadBookings();
  } catch (error) {
    console.error('Failed to add booking:', error);
    showToast('Failed to add booking');
  }
}

function setEarningsDateToToday() {
  const earningsDateInput = document.getElementById('earningsDate');
  if (!earningsDateInput) return;
  earningsDateInput.value = formatDateKey(new Date());
  updateEarnings();
}

// Format date to YYYY-MM-DD
function formatTimeInputValue(value) {
  if (!value) return '';
  const trimmed = value.trim();

  const parseSingleTime = (input) => {
    const normalized = input.trim().replace(/\s+/g, ' ');
    const ampmMatch = normalized.match(/^([0-9]{1,2})(?::([0-9]{2}))?\s*(AM|PM)$/i);
    if (ampmMatch) {
      let hours = Number(ampmMatch[1]);
      const minutes = Number(ampmMatch[2] || '00');
      const suffix = ampmMatch[3].toUpperCase();
      if (hours === 0) hours = 12;
      if (hours > 12) hours = hours % 12;
      return `${hours}:${String(minutes).padStart(2, '0')} ${suffix}`;
    }

    const twentyFourMatch = normalized.match(/^([0-9]{1,2})(?::([0-9]{2}))?$/);
    if (twentyFourMatch) {
      let hours = Number(twentyFourMatch[1]);
      const minutes = Number(twentyFourMatch[2] || '00');
      if (hours >= 24 || minutes >= 60) return normalized;
      const suffix = hours >= 12 ? 'PM' : 'AM';
      if (hours === 0) hours = 12;
      else if (hours > 12) hours -= 12;
      return `${hours}:${String(minutes).padStart(2, '0')} ${suffix}`;
    }

    return normalized;
  };

  const rangeMatch = trimmed.match(/^(.+?)\s*-\s*(.+)$/);
  if (rangeMatch) {
    const start = parseSingleTime(rangeMatch[1]);
    const end = parseSingleTime(rangeMatch[2]);
    return `${start} - ${end}`;
  }

  return parseSingleTime(trimmed);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Pagination
function buildPageButtons(totalPages, currentPage) {
  const buttons = [];
  const maxButtons = 20;

  if (totalPages <= maxButtons) {
    for (let page = 1; page <= totalPages; page++) {
      buttons.push(page);
    }
    return buttons;
  }

  const visible = new Set([1, 2, totalPages - 1, totalPages]);
  visible.add(currentPage);
  if (currentPage - 1 > 1) visible.add(currentPage - 1);
  if (currentPage + 1 < totalPages) visible.add(currentPage + 1);
  if (currentPage - 2 > 1) visible.add(currentPage - 2);
  if (currentPage + 2 < totalPages) visible.add(currentPage + 2);

  const sorted = Array.from(visible).filter(page => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const expanded = [];
  let last = 0;

  sorted.forEach(page => {
    if (page - last > 1) {
      if (page - last === 2) {
        expanded.push(last + 1);
      } else {
        expanded.push('...');
      }
    }
    expanded.push(page);
    last = page;
  });

  return expanded;
}

function updatePagination() {
  const totalPages = Math.ceil(groupedBookings.length / itemsPerPage);
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  const pageButtons = document.getElementById('pageButtons');

  if (prevBtn) prevBtn.disabled = currentPage === 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages || totalPages === 0;

  if (!pageButtons) return;
  pageButtons.innerHTML = '';

  const pages = buildPageButtons(totalPages, currentPage);
  pages.forEach(page => {
    if (page === '...') {
      const ellipsis = document.createElement('span');
      ellipsis.className = 'page-break';
      ellipsis.textContent = '...';
      pageButtons.appendChild(ellipsis);
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'page-number-btn';
    btn.textContent = page;
    btn.disabled = page === currentPage;
    if (page === currentPage) {
      btn.classList.add('active');
    }
    btn.onclick = () => {
      currentPage = page;
      renderTable();
      updatePagination();
    };
    pageButtons.appendChild(btn);
  });
}

function openBookingDetails(group) {
  document.getElementById('detailsReference').textContent = group.reference_code || 'N/A';
  document.getElementById('detailsCustomer').textContent = group.customer_name || 'N/A';
  document.getElementById('detailsPhone').textContent = formatPhone(group.phone_number || 'N/A');
  document.getElementById('detailsBookedOn').textContent = group.bookedOn || 'N/A';
  document.getElementById('detailsTotal').textContent = '₱' + group.totalAmount.toLocaleString();
  document.getElementById('detailsStatus').textContent = group.status || 'pending';

  const list = document.getElementById('bookingDetailsList');
  list.innerHTML = '';
  group.bookings.forEach((booking, index) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    
    const topDiv = document.createElement('div');
    topDiv.className = 'list-item-top';
    topDiv.innerHTML = `
      <strong>Booking ${index + 1}</strong>
      <span class="status-badge ${booking.status || 'pending'}">${booking.status || 'pending'}</span>
    `;
    
    const bottomDiv = document.createElement('div');
    bottomDiv.className = 'list-item-bottom';
    bottomDiv.innerHTML = `
      <span>${booking.court || booking.court_name || 'Court'}</span>
      <span>${booking.booking_date || 'N/A'}</span>
      <span>${booking.time_slot || booking.booking_time || 'N/A'}</span>
      <span>₱${(booking.price || booking.rate || 0).toLocaleString()}</span>
    `;
    
    const actionDiv = document.createElement('div');
    actionDiv.className = 'list-item-actions';
    
    if (booking.status === 'pending') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'action-btn delete-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = () => deleteBooking(booking);
      actionDiv.appendChild(deleteBtn);
    } else {
      const pendingBtn = document.createElement('button');
      pendingBtn.className = 'action-btn';
      pendingBtn.textContent = 'Mark Pending';
      pendingBtn.onclick = async () => {
        const { error } = await setBookingsPending([booking.id]);
        if (error) {
          showToast('Failed to mark as pending');
        } else {
          showToast('Booking marked as pending');
          await loadBookings();
          openBookingDetails(group);
        }
      };
      actionDiv.appendChild(pendingBtn);
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'action-btn delete-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = () => deleteBooking(booking);
      actionDiv.appendChild(deleteBtn);
    }
    
    item.appendChild(topDiv);
    item.appendChild(bottomDiv);
    item.appendChild(actionDiv);
    list.appendChild(item);
  });

  currentBookingDetailsGroup = group;
  document.getElementById('bookingDetailsModal').classList.add('open');
}

function closeBookingDetails() {
  document.getElementById('bookingDetailsModal').classList.remove('open');
  currentBookingDetailsGroup = null;
}

function copyBookingDetailsConfirmation() {
  const group = currentBookingDetailsGroup;
  if (!group) {
    showToast('No booking details available to copy');
    return;
  }

  const customerName = group.customer_name || 'N/A';
  const bookingReference = group.reference_code || 'N/A';
  const totalPaid = `₱${(group.totalAmount || 0).toLocaleString()}`;

  const sortTime = (timeStr) => {
    // Match time at the start: "8PM" or "8:30PM" (handles both HH:MM and HH formats)
    const match = timeStr.match(/^(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (!match) return 0;
    let hours = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const meridiem = match[3].toUpperCase();
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };

  // Group bookings by date
  const dateGroups = (group.bookings || []).reduce((acc, booking) => {
    const date = booking.booking_date || 'N/A';
    const courtName = booking.court || booking.court_name || 'N/A';
    const timeSlot = booking.time_slot || booking.booking_time || 'N/A';
    
    if (!acc[date]) acc[date] = {};
    if (!acc[date][courtName]) acc[date][courtName] = [];
    if (!acc[date][courtName].includes(timeSlot)) acc[date][courtName].push(timeSlot);
    
    return acc;
  }, {});

  // Sort dates
  const sortedDates = Object.keys(dateGroups).sort((a, b) => new Date(a) - new Date(b));

  // Build message with separated dates
  const dateBookingLines = sortedDates.map(date => {
    const formattedDate = new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const courtGroups = dateGroups[date];
    
    const courtLines = Object.entries(courtGroups).map(([courtName, times]) => {
      times.sort((a, b) => sortTime(a) - sortTime(b));
      const timesList = times.map(timeSlot => ` ${timeSlot}`).join('\n');
      return `${courtName}\n${timesList}`;
    }).join('\n\n');

    return `📅 ${formattedDate}\n${courtLines}`;
  }).join('\n\n');

  const message = `BOOKING CONFIRMATION\n\nHello ${customerName},\n\nThank you for booking with Pickle Social - Cebu! Your reservation has been successfully confirmed. ✅\n\n📌 Booking Reference: ${bookingReference}\n💳 Total Paid: ${totalPaid}\n\n${dateBookingLines}\n\nThank you for booking with us! Your reservation has been successfully confirmed.`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).then(() => {
      showToast('Booking confirmation copied');
    }).catch(() => {
      prompt('Copy the text below for Messenger:', message);
    });
  } else {
    prompt('Copy the text below for Messenger:', message);
  }
}

function copyBookingDetailsPendingMessage() {
  const group = currentBookingDetailsGroup;
  if (!group) {
    showToast('No booking details available to copy');
    return;
  }

  const customerName = group.customer_name || group.customer || 'Customer';
  const bookingReference = group.reference_code || group.reference || 'N/A';
  const totalAmount = group.totalAmount || (group.bookings || []).reduce((sum, booking) => {
    return sum + (parseFloat(booking.price) || parseFloat(booking.rate) || 0);
  }, 0);
  const totalDue = '₱' + totalAmount.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});

  const sortTime = (timeStr) => {
    const match = timeStr.match(/^(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (!match) return 0;
    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3].toUpperCase();
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };

  const dateGroups = (group.bookings || []).reduce((acc, booking) => {
    const date = booking.booking_date || 'N/A';
    const courtName = booking.court || booking.court_name || 'Court';
    const timeSlot = booking.time_slot || booking.booking_time || 'N/A';

    acc[date] = acc[date] || {};
    acc[date][courtName] = acc[date][courtName] || new Set();
    acc[date][courtName].add(timeSlot);

    return acc;
  }, {});

  const formattedDateGroups = Object.keys(dateGroups).sort((a, b) => new Date(a) - new Date(b)).map(date => {
    const formattedDate = isNaN(new Date(date).getTime()) ? date : new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const courtLines = Object.entries(dateGroups[date]).map(([courtName, timeSet]) => {
      const times = Array.from(timeSet).sort((a, b) => sortTime(a) - sortTime(b));
      const timeLines = times.map(timeSlot => `• ${timeSlot}`).join('\n');
      return `**${courtName}**\n${timeLines}`;
    }).join('\n\n');

    return `📅 ${formattedDate}\n\n${courtLines}`;
  }).join('\n\n');

  const message = `⏳ PENDING BOOKING CONFIRMATION\n\nHello ${customerName},\n\nThank you for your booking request at Pickle Social - Cebu.\n\n📌 Booking Reference: ${bookingReference}\n💳 Total Amount Due: ${totalDue}\n\n${formattedDateGroups}\n\n⚠️ Status: PENDING PAYMENT CONFIRMATION\n\nTo confirm your reservation, please send your GCash payment receipt together with your booking reference number via Messenger.\n\nYour selected time slots will remain reserved while awaiting payment verification.\n\nThank you, and we look forward to seeing you on the court! 🏓`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).then(() => {
      showToast('Pending message copied');
    }).catch(() => {
      prompt('Copy the text below for Messenger:', message);
    });
  } else {
    prompt('Copy the text below for Messenger:', message);
  }
}

function previousPage() {
  if (currentPage > 1) {
    currentPage--;
    renderTable();
    updatePagination();
  }
}

function nextPage() {
  const totalPages = Math.ceil(groupedBookings.length / itemsPerPage);
  if (currentPage < totalPages) {
    currentPage++;
    renderTable();
    updatePagination();
  }
}

// Refresh data
async function refreshData() {
  await loadBookings();
}

// Edit Modal
function openEditModal(booking) {
  currentEditingBooking = booking;
  document.getElementById('editRef').value = booking.reference_code || '';
  document.getElementById('editName').value = booking.customer_name || '';
  document.getElementById('editPhone').value = booking.phone_number || '';
  document.getElementById('editEmail').value = booking.customer_email || booking.email || '';
  document.getElementById('editStatus').value = booking.status || 'pending';
  document.getElementById('editAmount').value = booking.price || booking.rate || '';
  document.getElementById('editNotes').value = booking.notes || '';
  
  document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('open');
  currentEditingBooking = null;
}

function getReceiptImageUrl(booking) {
  return booking.receipt_url || booking.receipt_url_full || booking.receiptImageUrl || booking.receipt_image || booking.receipt_image_url || booking.receipt || null;
}

function openReceiptViewer(booking) {
  const imageUrl = getReceiptImageUrl(booking);
  const imageEl = document.getElementById('receiptViewImage');
  const placeholderEl = document.getElementById('receiptViewPlaceholder');

  if (imageEl && placeholderEl) {
    if (imageUrl) {
      imageEl.src = imageUrl;
      imageEl.style.display = 'block';
      placeholderEl.style.display = 'none';
    } else {
      imageEl.src = '';
      imageEl.style.display = 'none';
      placeholderEl.style.display = 'block';
    }
  }

  document.getElementById('receiptViewName').textContent = booking.customer_name || booking.name || 'Unknown';
  document.getElementById('receiptViewReference').textContent = booking.reference_code || booking.reference || 'N/A';
  document.getElementById('receiptViewDate').textContent = booking.booking_date || booking.date || 'N/A';
  document.getElementById('receiptViewTime').textContent = booking.time_slot || booking.booking_time || 'N/A';
  document.getElementById('receiptViewAmount').textContent = '₱' + ((booking.price || booking.rate || 0).toLocaleString());
  document.getElementById('receiptViewPayment').textContent = booking.payment_method || booking.paymentMethod || 'Unknown';
  document.getElementById('receiptViewTransaction').textContent = booking.transaction_id || booking.transaction || 'N/A';
  document.getElementById('receiptViewStatus').textContent = booking.status || 'pending';

  document.getElementById('receiptViewModal').classList.add('open');
}

function closeReceiptViewer() {
  document.getElementById('receiptViewModal').classList.remove('open');
}

async function saveBookingChanges() {
  if (!currentEditingBooking || !supabaseClient) {
    showToast('Error: booking not selected');
    return;
  }

  const name = document.getElementById('editName').value.trim();
  const phone = document.getElementById('editPhone').value.trim();
  const email = document.getElementById('editEmail').value.trim();
  const status = document.getElementById('editStatus').value;
  const amount = parseFloat(document.getElementById('editAmount').value) || 0;
  const notes = document.getElementById('editNotes').value.trim();

  if (!name || !phone) {
    showToast('âš ï¸ Please fill in all required fields');
    return;
  }

  try {
    console.log('=== UPDATING BOOKING ===');
    console.log('Booking ID:', currentEditingBooking.id);
    console.log('Customer Name:', name);
    console.log('Phone:', phone);

    const updateData = {
      customer_name: name,
      phone_number: phone,
      customer_email: email,
      status: status,
      price: amount,
      notes: notes
    };

    console.log('Update data:', JSON.stringify(updateData, null, 2));

    const { data, error, status: responseStatus, statusText } = await supabaseClient
      .from('bookings')
      .update(updateData)
      .eq('id', currentEditingBooking.id);

    console.log('Update response:', { data, error, status: responseStatus, statusText });

    if (error) {
      console.error('âŒ Update error:', error);
      console.error('Full error object:', JSON.stringify(error, null, 2));
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      console.error('Error details:', error.details);
      console.error('Error hint:', error.hint);
      
      // Show detailed error to user
      let errorMsg = error.message || 'Unknown error';
      if (error.details) errorMsg += '\n\nDetails: ' + error.details;
      if (error.hint) errorMsg += '\n\nHint: ' + error.hint;
      
      alert('Error updating booking:\n\n' + errorMsg + '\n\nCheck browser console (F12) for more details.');
      
      // Check if it's an RLS policy error
      if (error.code === 'PGRST301' || error.message.includes('policy')) {
        alert(
          'RLS Policy Error: Your Supabase database has Row Level Security policies that prevent updates.\n\n' +
          'To fix this:\n' +
          '1. Go to Supabase Dashboard\n' +
          '2. Select your database\n' +
          '3. Go to "Bookings" table\n' +
          '4. Click "Auth" menu\n' +
          '5. Check if RLS is enabled\n' +
          '6. Add an update policy or disable RLS for testing\n\n' +
          'Error: ' + error.message
        );
        return;
      }
      
      return;
    }

    console.log('Booking updated successfully');

    if (currentEditingBooking.status !== 'expired' && status === 'expired') {
      await addAdminLog(
        'expired',
        'Booking marked expired',
        `Booking ${currentEditingBooking.reference_code || currentEditingBooking.id} was marked as expired manually.`,
        {
          bookingId: currentEditingBooking.id,
          bookings: [{
            bookingId: currentEditingBooking.id,
            reference_code: currentEditingBooking.reference_code,
            customer_name: name,
            booking_date: currentEditingBooking.booking_date,
            booking_time: currentEditingBooking.booking_time || currentEditingBooking.time_slot,
            court: currentEditingBooking.court || currentEditingBooking.court_name,
            amount: amount || currentEditingBooking.price || currentEditingBooking.rate
          }],
          reference_code: currentEditingBooking.reference_code,
          customer_name: name,
          booking_date: currentEditingBooking.booking_date,
          booking_time: currentEditingBooking.booking_time || currentEditingBooking.time_slot,
          court: currentEditingBooking.court || currentEditingBooking.court_name,
          amount: amount || currentEditingBooking.price || currentEditingBooking.rate
        }
      );
    }

    showToast('Booking updated successfully');
    closeEditModal();
    await loadBookings();
  } catch (err) {
    console.error('âŒ Exception during update:', err);
    console.error('Error stack:', err.stack);
    showToast('Failed to save booking');
  }
}

// Copy to clipboard
function copyToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard');
  }).catch(() => {
    showToast(' Failed to copy');
  });
}

// Delete booking
async function deleteBooking(booking) {
  // Confirmation dialog
  const confirmed = confirm(
    `Are you sure you want to delete this booking?\n\n` +
    `Reference: ${booking.reference_code}\n` +
    `Customer: ${booking.customer_name}\n` +
    `Date: ${booking.booking_date}\n\n` +
    `This action cannot be undone.`
  );

  if (!confirmed) {
    return;
  }

  if (!supabaseClient) {
    showToast('Database not connected');
    return;
  }

  try {
    console.log('=== DELETING BOOKING ===');
    console.log('Booking ID:', booking.id);
    console.log('Booking Reference:', booking.reference_code);
    console.log('Booking Status:', booking.status);

    // Try deleting by ID first
    const { data, error, status, statusText } = await supabaseClient
      .from('bookings')
      .delete()
      .eq('id', booking.id);

    console.log('Delete response:', { data, error, status, statusText });

    if (error) {
      console.error('âŒ Delete error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      console.error('Error details:', error.details);
      console.error('Error hint:', error.hint);
      
      // Check if it's an RLS policy error
      if (error.code === 'PGRST301' || error.message.includes('policy')) {
        alert(
          'RLS Policy Error: Your Supabase database has Row Level Security policies that prevent deletion.\n\n' +
          'To fix this:\n' +
          '1. Go to Supabase Dashboard\n' +
          '2. Select your database\n' +
          '3. Go to "Bookings" table\n' +
          '4. Click "Auth" menu\n' +
          '5. Check if RLS is enabled\n' +
          '6. Add a delete policy or disable RLS for testing\n\n' +
          'Error: ' + error.message
        );
        return;
      }
      
      throw error;
    }

    console.log('Booking deleted from database');
    await addAdminLog(
      'deleted',
      'Booking deleted',
      `Deleted booking ${booking.reference_code || booking.id} for ${booking.customer_name || 'Unknown'}.`,
      {
        bookingId: booking.id,
        bookings: [{
          bookingId: booking.id,
          reference_code: booking.reference_code,
          customer_name: booking.customer_name,
          booking_date: booking.booking_date,
          booking_time: booking.booking_time || booking.time_slot,
          court: booking.court || booking.court_name,
          amount: booking.price || booking.rate
        }],
        reference_code: booking.reference_code,
        customer_name: booking.customer_name,
        booking_date: booking.booking_date,
        booking_time: booking.booking_time || booking.time_slot,
        court: booking.court || booking.court_name,
        amount: booking.price || booking.rate
      }
    );
    showToast('Booking deleted successfully');
    
    // Remove from local array and refresh UI immediately
    allBookings = allBookings.filter(b => b.id !== booking.id);
    applyFilters();
    updateEarnings();
    
  } catch (err) {
    console.error('âŒ Exception during delete:', err);
    console.error('Error stack:', err.stack);
    showToast('Failed to delete booking');
  }
}

async function deleteBookingGroup(group) {
  const deletableIds = group.bookings.filter(b => ['pending', 'expired'].includes(b.status)).map(b => b.id);
  if (deletableIds.length === 0) {
    showToast('No pending or expired bookings in this group to delete');
    return;
  }

  const confirmed = confirm(
    `Are you sure you want to delete ${deletableIds.length} pending/expired booking(s) for ${group.customer_name} (${group.reference_code})? This cannot be undone.`
  );
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('bookings')
    .delete()
    .in('id', deletableIds);

  if (error) {
    console.error('Bulk delete group error:', error);
    showToast('Failed to delete bookings');
    return;
  }

  const deletedBookings = group.bookings.filter(b => deletableIds.includes(b.id));
  const bookingPayload = deletedBookings.map(booking => ({
    bookingId: booking.id,
    reference_code: booking.reference_code,
    customer_name: booking.customer_name,
    booking_date: booking.booking_date,
    booking_time: booking.booking_time || booking.time_slot,
    court: booking.court || booking.court_name,
    amount: booking.price || booking.rate
  }));

  await addAdminLog(
    'deleted',
    'Booking group deleted',
    `Deleted ${deletedBookings.length} booking slot(s) from group ${group.reference_code || 'N/A'}.`,
    {
      bookingIds: deletableIds,
      bookings: bookingPayload,
      reference_code: group.reference_code,
      customer_name: group.customer_name,
      booking_date: deletedBookings[0]?.booking_date || null,
      booking_time: deletedBookings[0]?.booking_time || deletedBookings[0]?.time_slot || null,
      court: deletedBookings[0]?.court || deletedBookings[0]?.court_name || null,
      amount: deletedBookings[0]?.price || deletedBookings[0]?.rate || null
    }
  );
  showToast('Booking group deleted successfully');
  selectedBookingIds.clear();
  await loadBookings();
}

// Payment confirmation functions removed - now handled via Messenger automation
// Use the /api/confirm-booking endpoint to confirm bookings and send Messenger notifications

function copyBookingConfirmationText(group) {
  const customerName = group.customer_name || 'N/A';
  const bookingReference = group.reference_code || 'N/A';
  const totalPaid = `₱${(group.totalAmount || 0).toLocaleString()}`;
  const dates = Array.from(group.dates || new Set());
  const formattedDates = dates.length
    ? dates.map(d => {
        const parsed = new Date(d);
        if (isNaN(parsed)) return d;
        return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }).join(', ')
    : 'N/A';

  const courtGroups = (group.bookings || []).reduce((acc, booking) => {
    const courtName = booking.court || booking.court_name || 'N/A';
    const timeSlot = booking.time_slot || booking.booking_time || 'N/A';
    if (!acc[courtName]) acc[courtName] = [];
    if (!acc[courtName].includes(timeSlot)) acc[courtName].push(timeSlot);
    return acc;
  }, {});

  const timeIcons = ['ðŸ•š', 'ðŸ•›', 'ðŸ•', 'ðŸ•‘', 'ðŸ•’', 'ðŸ•“', 'ðŸ•”', 'ðŸ••', 'ðŸ•–', 'ðŸ•—', 'ðŸ•˜', 'ðŸ•™'];
  const bookingLines = Object.entries(courtGroups).map(([courtName, times]) => {
    const timeLines = times.map((timeSlot, index) => `${timeIcons[index] || 'ðŸ•š'} ${timeSlot}`).join('\n');
    return `ðŸŸï¸ ${courtName}\n${timeLines}`;
  }).join('\n\n');

  const message =
    `BOOKING CONFIRMATION\n\n` +
    `Hello ${customerName},\n\n` +
    `Thank you for booking with Pickle Social - Cebu! Your reservation has been successfully confirmed. âœ…\n\n` +
    `ðŸ“Œ Booking Reference: ${bookingReference}\n` +
    `ðŸ’³ Total Paid: ${totalPaid}\n` +
    `ðŸ“… Date: ${formattedDates}\n\n` +
    `${bookingLines ? bookingLines + '\n\n' : ''}` +
    `Thank you for booking with us! Your reservation has been successfully confirmed.`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).catch(() => {
      prompt('Copy the text below for Messenger:', message);
    });
  } else {
    prompt('Copy the text below for Messenger:', message);
  }
}

// Confirm payment - now handled via Messenger automation through /api/confirm-booking
// This function has been removed as bookings are now confirmed via direct Messenger API

// Confirm booking - shows booking info in modal with copy button and updates status
async function confirmBookingViaMessenger(group) {
  const referenceCode = group.reference_code;
  if (!referenceCode) {
    showToast('No reference code found');
    return;
  }

  const conflicts = findBookingConflicts(allBookings, group.bookings);
  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    const conflictReference = conflict.reference_code || 'another booking';
    showToast(`Cannot confirm: this slot is already booked (${conflictReference}).`);
    return;
  }

  try {
    const customerName = group.customer_name || 'N/A';
    const bookingReference = group.reference_code || 'N/A';
    const totalPaid = `₱${(group.totalAmount || 0).toLocaleString()}`;

    const sortTime = (timeStr) => {
      // Match time at the start: "8PM" or "8:30PM" (handles both HH:MM and HH formats)
      const match = timeStr.match(/^(\d+)(?::(\d+))?\s*(AM|PM)/i);
      if (!match) return 0;
      let hours = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      const meridiem = match[3].toUpperCase();
      if (meridiem === 'PM' && hours !== 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    };

    // Group bookings by date
    const dateGroups = (group.bookings || []).reduce((acc, booking) => {
      const date = booking.booking_date || 'N/A';
      const courtName = booking.court || booking.court_name || 'N/A';
      const timeSlot = booking.time_slot || booking.booking_time || 'N/A';
      
      if (!acc[date]) acc[date] = {};
      if (!acc[date][courtName]) acc[date][courtName] = [];
      if (!acc[date][courtName].includes(timeSlot)) acc[date][courtName].push(timeSlot);
      
      return acc;
    }, {});

    // Sort dates
    const sortedDates = Object.keys(dateGroups).sort((a, b) => new Date(a) - new Date(b));

    // Build message with separated dates
    const dateBookingLines = sortedDates.map(date => {
      const formattedDate = new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const courtGroups = dateGroups[date];
      
      const courtLines = Object.entries(courtGroups).map(([courtName, times]) => {
        times.sort((a, b) => sortTime(a) - sortTime(b));
        const timesList = times.map(timeSlot => ` ${timeSlot}`).join('\n');
        return `${courtName}\n${timesList}`;
      }).join('\n\n');

      return `📅 ${formattedDate}\n${courtLines}`;
    }).join('\n\n');

    const confirmationText = `BOOKING CONFIRMATION\n\nHello ${customerName},\n\nThank you for booking with Pickle Social - Cebu! Your reservation has been successfully confirmed. ✅\n\n📌 Booking Reference: ${bookingReference}\n💳 Total Paid: ${totalPaid}\n\n${dateBookingLines}\n\nThank you for booking with us! Your reservation has been successfully confirmed.`;

    // Store the text in a global variable for copying later
    window.currentConfirmationText = confirmationText;
    
    const currentAdmin = getCurrentAdmin();
    const confirmedBy = currentAdmin?.name || currentAdmin?.username || 'admin';
    const confirmedAt = new Date().toISOString();

    // Update booking status to "paid" in Supabase
    if (group.ids && group.ids.length > 0 && supabaseClient) {
      const { data, error } = await supabaseClient
        .from('bookings')
        .update({
          status: 'paid',
          confirmed_by: confirmedBy,
          confirmed_at: confirmedAt
        })
        .in('id', group.ids)
        .in('status', ['pending', 'unpaid'])
        .select();

      if (error) {
        console.error('Error updating booking status:', error);
        showToast('Warning: Could not update booking status');
      } else if (!data || data.length === 0) {
        console.log('Booking confirmation was already processed by another admin');
        showToast('This booking was already confirmed by another admin');
      } else {
        console.log('Booking status updated to paid');
      }
    }
    
    // Display in modal
    document.getElementById('confirmationText').textContent = confirmationText;
    document.getElementById('bookingConfirmationModal').style.display = 'flex';
    
    // Reload bookings to reflect the status change
    await loadBookings();
  } catch (error) {
    console.error('Error processing booking:', error);
    showToast(`Error: ${error.message}`);
  }
}

function closeBookingConfirmationModal() {
  document.getElementById('bookingConfirmationModal').style.display = 'none';
}

function copyConfirmationText() {
  const text = window.currentConfirmationText;
  if (!text) {
    showToast('No confirmation text to copy');
    return;
  }

  navigator.clipboard.writeText(text)
    .then(() => {
      showToast('Booking info copied to clipboard!');
      closeBookingConfirmationModal();
    })
    .catch(err => {
      console.error('Failed to copy:', err);
      showToast('Failed to copy booking info');
    });
}

function openTodayModal() {
  const today = new Date();
  const todayKey = formatDateKey(today);
  const todayBookings = allBookings.filter(b => {
    const bookingDate = b.booking_date || b.date || '';
    return bookingDate === todayKey;
  });
  const pending = todayBookings.filter(b => b.status === 'pending').length;
  const paidCompleted = todayBookings.filter(b => b.status === 'paid' || b.status === 'completed').length;

  document.getElementById('todaySummaryDate').textContent = today.toLocaleDateString();
  document.getElementById('todaySummaryTotal').textContent = todayBookings.length;
  document.getElementById('todaySummaryPending').textContent = pending;
  document.getElementById('todaySummaryPaid').textContent = paidCompleted;

  const listContainer = document.getElementById('todayBookingList');
  listContainer.innerHTML = '';

  if (todayBookings.length === 0) {
    listContainer.innerHTML = '<div class="empty-list">No bookings found for today.</div>';
  } else {
    todayBookings.forEach(booking => {
      const item = document.createElement('div');
      const bookingDate = booking.booking_date || booking.date || '';
      const timeSlot = booking.time_slot || booking.booking_time || 'TBD';
      const reference = booking.reference_code || booking.reference || '';
      item.className = 'list-item';
      item.innerHTML = `
        <div class="list-item-top">
          <div><strong>${booking.customer_name || 'Unknown'}</strong> Â· ${booking.court || booking.court_name || 'Court'}</div>
          <div class="status-badge ${booking.status || 'pending'}">${booking.status || 'pending'}</div>
        </div>
        <div class="list-item-bottom">
          <span>${bookingDate}</span>
          <span>${timeSlot}</span>
          <span>₱${(booking.price || booking.rate || 0).toLocaleString()}</span>
          <span>${reference}</span>
        </div>
      `;
      listContainer.appendChild(item);
    });
  }

  document.getElementById('todayModal').classList.add('open');
}

function closeTodayModal() {
  document.getElementById('todayModal').classList.remove('open');
}

// Logout
function logout() {
  if (confirm('Are you sure you want to logout?')) {
    sessionStorage.removeItem('adminToken');
    sessionStorage.removeItem('adminProfile');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminProfile');
    window.location.href = 'index.html';
  }
}

// Toast notification
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Close modal on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeEditModal();
    closeReceiptViewer();
    closeBookingDetails();
    closeTodayModal();
    closeCalendarModal();
  }
});




