import { _supabase } from '../config.js';
import '../widgets.js';
import '../global.js';

let currentUserId = null;
let myUsername = "";
let myProfile = null;

// Переменные пагинации
let allRacers = [];
let currentPage = 1;
const perPage = 10;

// Защита от XSS-инъекций в никнеймах
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.updateFriendsStatusOnly = function () {
  loadBlacklist();
};

window.onload = async () => {
  const { data: { user } } = await _supabase.auth.getUser();

  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  const nickEl = document.getElementById('displayNick');

  if (user) {
    // 1. АВТОРИЗОВАННЫЙ ГОНЩИК
    currentUserId = user.id;
    window.currentUserId = user.id;

    const { data: p } = await _supabase.from('profiles').select('*').eq('id', user.id).single();

    if (p) {
      p.isGuest = false;
      myProfile = p;
      window.myProfile = p;
      myUsername = p.username;

      if (nickEl) nickEl.innerText = p.username;
      if (loginBtn) loginBtn.style.display = 'none';
      if (userInfo) userInfo.style.display = 'flex';

      if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, p);
      if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, user.id);
      if (typeof updateFriendNotifications === 'function') updateFriendNotifications();
      if (typeof checkAdminReplies === 'function') checkAdminReplies();

      // Слушатели личных каналов
      _supabase.channel('leaderboard-msg-updates')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `receiver_id=eq.${user.id}`
        }, () => {
          if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, user.id);
        })
        .subscribe();

      _supabase.channel('support-realtime')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_tickets',
          filter: `user_id=eq.${user.id}`
        }, (payload) => {
          if (typeof checkAdminReplies === 'function') checkAdminReplies();
          if (payload.new.status === 'resolved' && !payload.new.is_read) {
            if (typeof playNotificationSound === 'function') playNotificationSound();
          }
        })
        .subscribe();
    }
  } else {
    // 2. ГОСТЕВОЙ РЕЖИМ
    myProfile = {
      id: null,
      username: 'Guest_' + Math.random().toString(36).substring(2, 6),
      isGuest: true,
      status: 'GUEST',
      avatar_url: 'https://via.placeholder.com/34?text=G'
    };
    window.myProfile = myProfile;
    window.currentUserId = null;
    myUsername = "";

    // Показываем кнопку входа и прячем данные авторизованного профиля
    if (loginBtn) {
      loginBtn.style.display = 'inline-block';
      loginBtn.href = 'auth.html';
    }
    if (userInfo) userInfo.style.display = 'none';
    if (nickEl) {
      nickEl.innerText = 'GUEST';
      nickEl.style.color = '#888';
    }

    if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, null);
  }

  // Загрузка таблицы лидеров (доступна всем)
  await loadBlacklist();
};

async function loadBlacklist() {
  const { data, error } = await _supabase
    .from('profiles')
    .select('*')
    .order('rating', { ascending: false });

  if (error) {
    console.error('Failed to load blacklist:', error);
    return;
  }

  allRacers = data || [];
  renderLeaderboard();
  renderPagination();
}

function renderLeaderboard() {
  const tbody = document.getElementById('blacklistBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (allRacers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 25px; color: #666;">No racers registered yet.</td></tr>`;
    return;
  }

  const startIndex = (currentPage - 1) * perPage;
  const endIndex = startIndex + perPage;
  const pageData = allRacers.slice(startIndex, endIndex);

  pageData.forEach((racer, index) => {
    const rank = startIndex + index + 1;
    // (YOU) отображается только для авторизованного пользователя
    const isMe = !myProfile?.isGuest && myUsername !== "" && myUsername === racer.username;
    const presence = (typeof onlineUsers !== 'undefined') ? onlineUsers[racer.username] : null;

    let statusText = "OFFLINE";
    let statusClass = "offline";
    let borderColor = "#444444";

    if (presence && presence[0]) {
      statusClass = 'online';
      const pData = presence[0];

      if (pData.status === 'IN-GAME') {
        statusText = 'IN-GAME';
        borderColor = 'var(--nfs-yellow, #f1c40f)';
      } else {
        statusText = 'ONLINE';
        borderColor = '#2ecc71';
      }
    }

    const avatarStyle = `border: 2px solid ${borderColor}; transition: border-color 0.3s;`;
    const safeUsername = escapeHtml(racer.username);

    const avatarHTML = racer.avatar_url
      ? `<img src="${racer.avatar_url}" class="racer-avatar" style="${avatarStyle}">`
      : `<div class="racer-avatar" style="display:flex; align-items:center; justify-content:center; color:#555; font-weight:900; background:#111; ${avatarStyle}">?</div>`;

    let rankClass = '';
    if (rank === 1) rankClass = 'top-rank rank-1';
    else if (rank === 2) rankClass = 'top-rank rank-2';
    else if (rank === 3) rankClass = 'top-rank rank-3';

    const row = document.createElement('tr');
    row.className = `blacklist-row ${rank === 1 ? 'rank-1-row' : ''}`;

    if (isMe && rank !== 1) {
      row.style.background = "rgba(255, 255, 255, 0.08)";
    }

    row.onclick = () => window.location.href = `profile.html?u=${encodeURIComponent(racer.username)}`;

    row.innerHTML = `
      <td class="rank-num ${rankClass}">
        #${rank}
      </td>
      <td>
         <div style="display: inline-block;">
            ${avatarHTML}
         </div>
      </td>
      <td>
        <span class="racer-name ${racer.is_admin ? 'admin-name' : ''}">
          ${safeUsername} ${isMe ? '<small style="color:var(--nfs-yellow, #f1c40f); font-size: 0.6rem;">(YOU)</small>' : ''}
        </span>
      </td>
      <td style="font-weight: bold; color: var(--nfs-yellow, #f1c40f); font-size: 1.1rem;">
        ${(racer.rating || 0).toLocaleString()}
      </td>
      <td>
        <span class="racer-status ${statusClass}" style="border-color: ${borderColor}; color: ${borderColor}; transition: 0.3s;">
          ${statusText}
        </span>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function renderPagination() {
  const paginationContainer = document.getElementById('pagination');
  if (!paginationContainer) return;
  paginationContainer.innerHTML = '';

  const totalPages = Math.ceil(allRacers.length / perPage);
  if (totalPages <= 1) return;

  // Кнопка "<" (Назад)
  const prevBtn = document.createElement('button');
  prevBtn.innerText = '<';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      renderLeaderboard();
      renderPagination();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  paginationContainer.appendChild(prevBtn);

  // Номера страниц (1, 2, 3...)
  for (let i = 1; i <= totalPages; i++) {
    const pageBtn = document.createElement('button');
    pageBtn.innerText = i;
    if (i === currentPage) pageBtn.classList.add('active');

    pageBtn.onclick = () => {
      currentPage = i;
      renderLeaderboard();
      renderPagination();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    paginationContainer.appendChild(pageBtn);
  }

  // Кнопка ">" (Вперед)
  const nextBtn = document.createElement('button');
  nextBtn.innerText = '>';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderLeaderboard();
      renderPagination();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  paginationContainer.appendChild(nextBtn);
}
