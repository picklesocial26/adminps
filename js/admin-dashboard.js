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
        times: new Set()
      };
    }

    const group = groups[key];
    group.ids.push(booking.id);
    group.bookings.push(booking);
    group.totalAmount += (booking.price || booking.rate || 0);
    group.courts.add(booking.court || booking.court_name || 'N/A');
    group.dates.add(booking.booking_date || 'N/A');
    group.times.add(booking.time_slot || booking.booking_time || 'N/A');

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
    group.status = group.bookings.some(b => b.status === 'pending') ? 'pending' : group.bookings.some(b => b.status === 'paid') ? 'paid' : group.bookings[0]?.status || 'pending';
    return group;
  });
}

// Check authentication
function checkAuthentication() {
  const token = sessionStorage.getItem('adminToken');
  if (!token) {
    // Not logged in, redirect to login
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
  const SUPABASE_URL = "https://nozisfmqzkeywefrqkok.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vemlzZm1xemtleXdlZnJxa29rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NzY2NzcsImV4cCI6MjA5NDE1MjY3N30.9CyqA4zZ9o5glyVl40Baah9ce-mqPIB3fAi2wp2-Ppk";

  try {
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

    setInterval(async () => {
      if (!supabaseClient || allBookings.length === 0) return;
      const expiredUpdated = await updateExpiredBookings(allBookings);
      if (expiredUpdated) {
        await loadBookings();
      }
    }, 60000);
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

    allBookings = data || [];
    selectedBookingIds.clear();
    console.log('Loaded bookings:', allBookings);
    
    // Check and update expired bookings
    const expiredUpdated = await updateExpiredBookings(allBookings);
    if (expiredUpdated) {
      await loadBookings();
      return;
    }
    
    applyFilters();
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
          const pendingTimeout = 30 * 60 * 1000; // 30 minutes
          if (now - createdAt >= pendingTimeout) {
            shouldExpire = true;
          }
        }
      }

      if (!shouldExpire) {
        const bookingDate = booking.booking_date;
        const timeSlot = booking.time_slot || booking.booking_time || '';

        if (!bookingDate) continue;

        // Parse booking date and time
        // Assuming date format is YYYY-MM-DD and time format is HH:MM or HH:MM:SS
        let bookingDateTime;
        
        if (timeSlot) {
          // Combine date and time
          bookingDateTime = new Date(`${bookingDate}T${timeSlot}`);
        } else {
          // If no time slot, set to end of day
          bookingDateTime = new Date(bookingDate);
          bookingDateTime.setHours(23, 59, 59);
        }

        // Expire a pending booking if its target time has passed
        if (bookingDateTime < now) {
          shouldExpire = true;
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
  renderTable();
  updatePagination();
  updateEarnings();
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
    detailsBtn.className = 'action-btn';
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
    row.appendChild(courtCell);
    row.appendChild(dateCell);
    row.appendChild(timeCell);
    row.appendChild(amountCell);
    row.appendChild(statusCell);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  });

  updateBulkActions();
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

function toggleSelectAll(element) {
  if (element.checked) {
    groupedBookings.forEach(group => group.ids.forEach(id => selectedBookingIds.add(id)));
  } else {
    selectedBookingIds.clear();
  }
  renderTable();
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
  document.getElementById('selectAllCheckbox').checked = count > 0 && filteredBookings.every(b => selectedBookingIds.has(b.id));
}

function getSelectedBookings() {
  return allBookings.filter(booking => selectedBookingIds.has(booking.id));
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

  showToast('Selected bookings deleted');
  selectedBookingIds.clear();
  await loadBookings();
}

function downloadCsv() {
  if (filteredBookings.length === 0) {
    showToast('No bookings to export');
    return;
  }

  const rows = [
    ['Reference', 'Name', 'Phone', 'Email', 'Court', 'Date', 'Time', 'Amount', 'Payment Method', 'Transaction ID', 'Status', 'Notes']
  ];

  filteredBookings.forEach(b => {
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

  const csvContent = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bookings_export_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Export ready');
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

  console.log('Earnings updated:', { todayEarnings, weeklyEarnings, monthlyEarnings, selectedDate: formatDateKey(selectedDate), weekStart: formatDateKey(weekStart), weekEnd: formatDateKey(weekEnd), monthStart: formatDateKey(monthStart), monthEnd: formatDateKey(monthEnd) });
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

function setEarningsDateToToday() {
  const earningsDateInput = document.getElementById('earningsDate');
  if (!earningsDateInput) return;
  earningsDateInput.value = formatDateKey(new Date());
  updateEarnings();
}

// Format date to YYYY-MM-DD
function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Pagination
function updatePagination() {
  const totalPages = Math.ceil(groupedBookings.length / itemsPerPage);
  const pageInfo = document.getElementById('pageInfo');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');

  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  prevBtn.disabled = currentPage === 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function openBookingDetails(group) {
  document.getElementById('detailsReference').textContent = group.reference_code || 'N/A';
  document.getElementById('detailsCustomer').textContent = group.customer_name || 'N/A';
  document.getElementById('detailsPhone').textContent = formatPhone(group.phone_number || 'N/A');
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
        const { error } = await supabaseClient
          .from('bookings')
          .update({ status: 'pending' })
          .eq('id', booking.id);
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
}function previousPage() {
  if (currentPage > 1) {
    currentPage--;
    renderTable();
    updatePagination();
  }
}

function nextPage() {
  const totalPages = Math.ceil(filteredBookings.length / itemsPerPage);
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
    
    // Update booking status to "paid" in Supabase
    if (group.ids && group.ids.length > 0 && supabaseClient) {
      const { error } = await supabaseClient
        .from('bookings')
        .update({ status: 'paid' })
        .in('id', group.ids);

      if (error) {
        console.error('Error updating booking status:', error);
        showToast('Warning: Could not update booking status');
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
  
  navigator.clipboard.writeText(text).then(() => {
    showToast('Booking info copied to clipboard!');
    
    // Close the modal
    closeBookingConfirmationModal();
    
    // Detect if mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      // On mobile, try to open Business Suite app or Messenger
      // For iOS
      if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
        window.location.href = 'fb://'; // Opens Facebook app
      } 
      // For Android
      else {
        window.location.href = 'fb://'; // Opens Facebook app
      }
      
      // Fallback to web after a delay if app doesn't open
      setTimeout(() => {
        window.open('https://business.facebook.com/latest/inbox/messenger', '_blank');
      }, 1500);
    } else {
      // On desktop, open the web URL
      window.open('https://business.facebook.com/latest/inbox/messenger', '_blank');
    }
  }).catch(err => {
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
  }
});




