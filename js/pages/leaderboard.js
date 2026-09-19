import {_supabase} from '../config.js';
import '../widgets.js';
import '../global.js';

let currentUserId = null;
let myUsername = "";
let myProfile = null;

// Переменные пагинации
let allRacers = [];
let currentPage = 1;
const perPage = 10;

window.updateFriendsStatusOnly = function () {
  loadBlacklist();
};

window.onload = async () => {
  const {data: {user}} = await _supabase.auth.getUser();

  if (user) {
    currentUserId = user.id;
    window.currentUserId = user.id;
    const {data: p} = await _supabase.from('profiles').select('*').eq('id', user.id).single();

    if (p) {
      myProfile = p;
      window.myProfile = p;
      myUsername = p.username;

      const nickEl = document.getElementById('displayNick');
      if (nickEl) nickEl.innerText = p.username;

      const loginBtn = document.getElementById('loginBtn');
      const userInfo = document.getElementById('userInfo');
      if (loginBtn) loginBtn.style.display = 'none';
      if (userInfo) userInfo.style.display = 'flex';

      if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, p);
      if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, user.id);
      if (typeof updateFriendNotifications === 'function') updateFriendNotifications();

      checkAdminReplies();

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
          checkAdminReplies();
          if (payload.new.status === 'resolved' && !payload.new.is_read) {
            if (typeof playNotificationSound === 'function') playNotificationSound();
          }
        })
        .subscribe();
    }
  } else {
    if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, null);
  }

  await loadBlacklist();
};

async function loadBlacklist() {
  const {data, error} = await _supabase
    .from('profiles')
    .select('*')
    .order('rating', {ascending: false});

  if (error) return;

  allRacers = data || [];
  renderLeaderboard();
  renderPagination();
}

function renderLeaderboard() {
  const tbody = document.getElementById('blacklistBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const startIndex = (currentPage - 1) * perPage;
  const endIndex = startIndex + perPage;
  const pageData = allRacers.slice(startIndex, endIndex);

  pageData.forEach((racer, index) => {
    const rank = startIndex + index + 1;
    const isMe = myUsername === racer.username;
    const presence = (typeof onlineUsers !== 'undefined') ? onlineUsers[racer.username] : null;

    let statusText = "OFFLINE";
    let statusClass = "offline";
    let borderColor = "#444444";

    if (presence && presence[0]) {
      statusClass = 'online';
      const pData = presence[0];

      if (pData.status === 'IN-GAME') {
        statusText = 'IN-GAME';
        borderColor = 'var(--nfs-yellow)';
      } else {
        statusText = 'ONLINE';
        borderColor = '#2ecc71';
      }
    }

    const avatarStyle = `border: 2px solid ${borderColor}; transition: border-color 0.3s;`;

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

    row.onclick = () => window.location.href = `profile.html?u=${racer.username}`;

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
          ${racer.username} ${isMe ? '<small style="color:var(--nfs-yellow); font-size: 0.6rem;">(YOU)</small>' : ''}
        </span>
      </td>
      <td style="font-weight: bold; color: var(--nfs-yellow); font-size: 1.1rem;">
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
