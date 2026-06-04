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
        receipt_reference: booking.receipt_reference || booking.receipt_reference || 'N/A',
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

    if (booking.receipt_reference) group.receipt_reference = booking.receipt_reference;
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
    
    showToast('✅ Connected to database');
    
    // Set today's date as default range filter
    const today = new Date();
    const dateFrom = document.getElementById('filterFrom');
    const dateTo = document.getElementById('filterTo');
    if (dateFrom) dateFrom.valueAsDate = today;
    if (dateTo) dateTo.valueAsDate = today;
    
    // Load initial data
    await loadBookings();
    updateEarnings();
  } catch (err) {
    console.error('Initialization error:', err);
    showToast('❌ Failed to connect to database');
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
    
    applyFilters();
  } catch (err) {
    console.error('Error loading bookings:', err);
    showToast('❌ Failed to load bookings');
  }
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
    const searchValue = [booking.reference_code, booking.receipt_reference, booking.customer_name, booking.phone_number, booking.customer_email, booking.booking_date, booking.court, booking.court_name]
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
    const receiptRefCell = createCell(group.receipt_reference || 'N/A');
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
    if (group.status === 'pending') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'action-btn delete-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.title = 'Delete this pending booking group';
      deleteBtn.onclick = () => deleteBookingGroup(group);
      actionCell.appendChild(deleteBtn);

      if (group.receipt_reference && group.receipt_reference !== 'N/A') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'action-btn confirm-btn';
        confirmBtn.textContent = 'Confirm & Copy';
        confirmBtn.title = 'Confirm payment, mark as paid, and copy Messenger text';
        confirmBtn.onclick = () => confirmPaymentGroup(group);
        actionCell.appendChild(confirmBtn);
      }
    }

    row.appendChild(selectCell);
    row.appendChild(refCell);
    row.appendChild(receiptRefCell);
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
    showToast('⚠️ No bookings selected');
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
    showToast('❌ Failed to mark paid');
    return;
  }

  showToast('✅ Bookings marked paid');
  selectedBookingIds.clear();
  await loadBookings();
}

async function bulkCancel() {
  const selected = getSelectedBookings();
  if (selected.length === 0) {
    showToast('⚠️ No bookings selected');
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
    showToast('❌ Failed to cancel');
    return;
  }

  showToast('✅ Bookings cancelled');
  selectedBookingIds.clear();
  await loadBookings();
}

async function bulkDelete() {
  const selected = getSelectedBookings();
  if (selected.length === 0) {
    showToast('⚠️ No bookings selected for delete');
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
    showToast('❌ Failed to delete selected bookings');
    return;
  }

  showToast('✅ Selected bookings deleted');
  selectedBookingIds.clear();
  await loadBookings();
}

function downloadCsv() {
  if (filteredBookings.length === 0) {
    showToast('⚠️ No bookings to export');
    return;
  }

  const rows = [
    ['Reference', 'Receipt Reference', 'Name', 'Phone', 'Email', 'Court', 'Date', 'Time', 'Amount', 'Payment Method', 'Transaction ID', 'Status', 'Notes']
  ];

  filteredBookings.forEach(b => {
    rows.push([
      b.reference_code || '',
      b.receipt_reference || '',
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
  showToast('✅ Export ready');
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
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const todayKey = formatDateKey(today);
  const weekAgoKey = formatDateKey(weekAgo);
  const monthAgoKey = formatDateKey(monthAgo);

  // Calculate totals
  const todayBookings = filteredBookings.filter(b => 
    b.booking_date === todayKey && (b.status === 'paid' || b.status === 'completed')
  );
  const todayEarnings = todayBookings.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);

  const weeklyBookings = filteredBookings.filter(b => {
    const bDate = new Date(b.booking_date);
    return bDate >= weekAgo && bDate <= today && (b.status === 'paid' || b.status === 'completed');
  });
  const weeklyEarnings = weeklyBookings.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);

  const monthlyBookings = filteredBookings.filter(b => {
    const bDate = new Date(b.booking_date);
    return bDate >= monthAgo && bDate <= today && (b.status === 'paid' || b.status === 'completed');
  });
  const monthlyEarnings = monthlyBookings.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);

  const pendingBookings = filteredBookings.filter(b => b.status === 'pending');
  const pendingAmount = pendingBookings.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);

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
  document.getElementById('detailsReceiptRef').textContent = group.receipt_reference || 'N/A';
  document.getElementById('detailsTotal').textContent = '₱' + group.totalAmount.toLocaleString();
  document.getElementById('detailsStatus').textContent = group.status || 'pending';

  const list = document.getElementById('bookingDetailsList');
  list.innerHTML = '';
  group.bookings.forEach((booking, index) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-item-top">
        <strong>Booking ${index + 1}</strong>
        <span class="status-badge ${booking.status || 'pending'}">${booking.status || 'pending'}</span>
      </div>
      <div class="list-item-bottom">
        <span>${booking.court || booking.court_name || 'Court'}</span>
        <span>${booking.booking_date || 'N/A'}</span>
        <span>${booking.time_slot || booking.booking_time || 'N/A'}</span>
        <span>₱${(booking.price || booking.rate || 0).toLocaleString()}</span>
      </div>
    `;
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
    showToast('⚠️ No booking details available to copy');
    return;
  }

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

  const timeIcons = ['🕚', '🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙'];
  const bookingLines = Object.entries(courtGroups).map(([courtName, times]) => {
    const timeLines = times.map((timeSlot, index) => `${timeIcons[index] || '🕚'} ${timeSlot}`).join('\n');
    return `🏟️ ${courtName}\n${timeLines}`;
  }).join('\n\n');

  const message =
    `BOOKING CONFIRMATION\n\n` +
    `Hello ${customerName},\n\n` +
    `Thank you for booking with Pickle Social - Cebu! Your reservation has been successfully confirmed. ✅\n\n` +
    `📌 Booking Reference: ${bookingReference}\n` +
    `💳 Total Paid: ${totalPaid}\n` +
    `📅 Date: ${formattedDates}\n\n` +
    `${bookingLines ? bookingLines + '\n\n' : ''}` +
    `Thank you for booking with us! Your reservation has been successfully confirmed.`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).then(() => {
      showToast('✅ Booking confirmation copied');
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
  document.getElementById('editPaymentMethod').value = booking.payment_method || booking.paymentMethod || '';
  document.getElementById('editTransactionId').value = booking.transaction_id || booking.transaction || '';
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
  document.getElementById('receiptViewReceipt').textContent = booking.receipt_reference || 'N/A';
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
    showToast('❌ Error: booking not selected');
    return;
  }

  const name = document.getElementById('editName').value.trim();
  const phone = document.getElementById('editPhone').value.trim();
  const email = document.getElementById('editEmail').value.trim();
  const status = document.getElementById('editStatus').value;
  const amount = parseFloat(document.getElementById('editAmount').value) || 0;
  const paymentMethod = document.getElementById('editPaymentMethod').value.trim();
  const transactionId = document.getElementById('editTransactionId').value.trim();
  const notes = document.getElementById('editNotes').value.trim();

  if (!name || !phone) {
    showToast('⚠️ Please fill in all required fields');
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('bookings')
      .update({
        customer_name: name,
        phone_number: phone,
        customer_email: email,
        status: status,
        price: amount,
        rate: amount,
        payment_method: paymentMethod,
        transaction_id: transactionId,
        notes: notes
      })
      .eq('id', currentEditingBooking.id);

    if (error) throw error;

    showToast('✅ Booking updated successfully');
    closeEditModal();
    await loadBookings();
  } catch (err) {
    console.error('Error saving booking:', err);
    showToast('❌ Failed to save booking');
  }
}

// Copy to clipboard
function copyToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast('✅ Copied to clipboard');
  }).catch(() => {
    showToast('❌ Failed to copy');
  });
}

// Delete booking
async function deleteBooking(booking) {
  if (!booking.status || booking.status !== 'pending') {
    showToast('⚠️ Only pending bookings can be deleted');
    return;
  }

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
    showToast('❌ Database not connected');
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
      console.error('❌ Delete error:', error);
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

    console.log('✅ Booking deleted from database');
    showToast('✅ Booking deleted successfully');
    
    // Remove from local array and refresh UI immediately
    allBookings = allBookings.filter(b => b.id !== booking.id);
    applyFilters();
    updateEarnings();
    
  } catch (err) {
    console.error('❌ Exception during delete:', err);
    console.error('Error stack:', err.stack);
    showToast('❌ Failed to delete booking');
  }
}

async function deleteBookingGroup(group) {
  const pendingIds = group.bookings.filter(b => b.status === 'pending').map(b => b.id);
  if (pendingIds.length === 0) {
    showToast('⚠️ No pending bookings in this group to delete');
    return;
  }

  const confirmed = confirm(
    `Are you sure you want to delete ${pendingIds.length} pending booking(s) for ${group.customer_name} (${group.reference_code})? This cannot be undone.`
  );
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('bookings')
    .delete()
    .in('id', pendingIds);

  if (error) {
    console.error('Bulk delete group error:', error);
    showToast('❌ Failed to delete bookings');
    return;
  }

  showToast('✅ Booking group deleted successfully');
  selectedBookingIds.clear();
  await loadBookings();
}

async function confirmPaymentGroup(group) {
  const pendingBookings = group.bookings.filter(b => b.status === 'pending' && b.receipt_reference);
  if (pendingBookings.length === 0) {
    showToast('⚠️ No pending bookings with receipt reference found');
    return;
  }

  const scheduleStrings = pendingBookings
    .map(b => {
      const bookingDate = b.booking_date || b.date || '';
      const timeSlot = b.time_slot || b.booking_time || '';
      return bookingDate && timeSlot ? `${bookingDate} ${timeSlot}` : null;
    })
    .filter(Boolean);

  const conflictBookings = allBookings.filter(b => {
    if (group.ids.includes(b.id)) return false;
    const bookingDate = b.booking_date || b.date || '';
    const timeSlot = b.time_slot || b.booking_time || '';
    return scheduleStrings.includes(`${bookingDate} ${timeSlot}`);
  });

  if (conflictBookings.length > 0) {
    const conflictMessage = `Warning: ${conflictBookings.length} other booking(s) have the same date and time schedule as this group.\n\n` +
      `Please double check before confirming payment.\n\n` +
      `Continue anyway?`;
    const keepGoing = confirm(conflictMessage);
    if (!keepGoing) return;
  }

  const confirmed = confirm(
    `Confirm payment for ${pendingBookings.length} pending booking(s) for ${group.customer_name}? This will mark them as paid.`
  );
  if (!confirmed) return;

  const ids = pendingBookings.map(b => b.id);
  const { error } = await supabaseClient
    .from('bookings')
    .update({ status: 'paid' })
    .in('id', ids);

  if (error) {
    console.error('Bulk confirm group error:', error);
    showToast('❌ Failed to confirm payment');
    return;
  }

  copyBookingConfirmationText(group);
  showToast('✅ Booking group marked as paid and text copied');
  await loadBookings();
}

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

  const timeIcons = ['🕚', '🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙'];
  const bookingLines = Object.entries(courtGroups).map(([courtName, times]) => {
    const timeLines = times.map((timeSlot, index) => `${timeIcons[index] || '🕚'} ${timeSlot}`).join('\n');
    return `🏟️ ${courtName}\n${timeLines}`;
  }).join('\n\n');

  const message =
    `BOOKING CONFIRMATION\n\n` +
    `Hello ${customerName},\n\n` +
    `Thank you for booking with Pickle Social - Cebu! Your reservation has been successfully confirmed. ✅\n\n` +
    `📌 Booking Reference: ${bookingReference}\n` +
    `💳 Total Paid: ${totalPaid}\n` +
    `📅 Date: ${formattedDates}\n\n` +
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

// Confirm payment - mark pending booking as paid after admin verification
async function confirmPayment(booking) {
  if (!booking.status || booking.status !== 'pending') {
    showToast('⚠️ Only pending bookings can be confirmed');
    return;
  }

  if (!booking.receipt_reference) {
    showToast('⚠️ Booking does not have a receipt reference');
    return;
  }

  // Confirmation dialog
  const confirmed = confirm(
    `Are you sure you want to confirm payment for this booking?\n\n` +
    `Reference: ${booking.reference_code}\n` +
    `Receipt Reference: ${booking.receipt_reference}\n` +
    `Customer: ${booking.customer_name}\n` +
    `Amount: ₱${(booking.price || booking.rate || 0).toLocaleString()}\n` +
    `Date: ${booking.booking_date}\n\n` +
    `This will mark the booking as PAID.`
  );

  if (!confirmed) {
    return;
  }

  if (!supabaseClient) {
    showToast('❌ Database not connected');
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('bookings')
      .update({ status: 'paid' })
      .eq('id', booking.id);

    if (error) throw error;

    console.log('✅ Booking confirmed and marked as paid:', booking.id);

    // Copy the booking confirmation text automatically after confirmation
    const bookingGroup = {
      customer_name: booking.customer_name,
      reference_code: booking.reference_code || booking.reference || 'N/A',
      totalAmount: booking.price || booking.rate || 0,
      dates: new Set([booking.booking_date || booking.date || 'N/A']),
      bookings: [booking]
    };
    copyBookingConfirmationText(bookingGroup);
    showToast('✅ Payment confirmed and confirmation text copied');

    // Refresh data
    await loadBookings();
    
  } catch (err) {
    console.error('❌ Error confirming payment:', err);
    showToast('❌ Failed to confirm payment');
  }
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
          <div><strong>${booking.customer_name || 'Unknown'}</strong> · ${booking.court || booking.court_name || 'Court'}</div>
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
