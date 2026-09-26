import { _supabase } from '../config.js';
import '../widgets.js';
import '../global.js';

if (typeof onlineUsers === 'undefined') window.onlineUsers = {};

window.currentUserId = null;
window.myProfile = null;
window.profileData = null;

window.onload = async () => {
  const { data: { user } } = await _supabase.auth.getUser();

  if (user) {
    // 1. АВТОРИЗОВАННЫЙ ПОЛЬЗОВАТЕЛЬ
    window.currentUserId = user.id;

    const { data: me } = await _supabase.from('profiles').select('*').eq('id', window.currentUserId).single();
    if (me) {
      me.isGuest = false;
      window.myProfile = me;

      if (typeof checkDailyBonus === 'function') await checkDailyBonus(me);

      const savedStatus = localStorage.getItem('driver_status') || me.status || 'ONLINE';
      window.myProfile.status = savedStatus;

      await _supabase.from('profiles').update({ status: savedStatus }).eq('id', user.id);
      if (typeof window.trackMyStatus === 'function') await window.trackMyStatus(savedStatus);

      const nickEl = document.getElementById('displayNick');
      if (nickEl) nickEl.innerText = me.username;
      if (typeof updateFriendNotifications === 'function') updateFriendNotifications();
      if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, me);
      if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, me.id);
      if (typeof checkAdminReplies === 'function') checkAdminReplies();

      // Слушатель тикетов только для реального аккаунта
      _supabase.channel('support-realtime')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_tickets',
          filter: `user_id=eq.${me.id}`
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
    window.currentUserId = null;
    window.myProfile = {
      id: null,
      username: 'Guest_' + Math.random().toString(36).substring(2, 6),
      isGuest: true,
      status: 'GUEST',
      avatar_url: 'https://via.placeholder.com/34?text=G'
    };

    const nickEl = document.getElementById('displayNick');
    if (nickEl) {
      nickEl.innerText = 'GUEST';
      nickEl.style.color = '#888';
    }

    if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, null);
  }

  // ОПРЕДЕЛЕНИЕ СТРАНИЦЫ (ЧУЖОЙ ПРОФИЛЬ ИЛИ СВОЙ)
  const urlParams = new URLSearchParams(window.location.search);
  const targetName = urlParams.get('u');

  if (targetName) {
    const { data } = await _supabase.from('profiles').select('*').ilike('username', targetName).maybeSingle();
    if (data) {
      window.profileData = data;
      setupProfileRealtimeListener();
      const isMine = window.currentUserId && data.id === window.currentUserId;
      renderFullProfile(data, isMine);
      updateRacerRank(data.id);
      checkFriendshipStatus(data.id);
    } else {
      if (window.myProfile?.isGuest) {
        renderGuestSelfProfile();
      } else if (window.currentUserId) {
        await loadMyOwnProfile(window.currentUserId);
        checkFriendshipStatus(window.currentUserId);
      }
    }
  } else {
    if (window.myProfile?.isGuest) {
      renderGuestSelfProfile();
    } else if (window.currentUserId) {
      await loadMyOwnProfile(window.currentUserId);
      checkFriendshipStatus(window.currentUserId);
    }
  }
};

/**
 * Отрисовка страницы, если гость открыл собственный профиль (без ?u=)
 */
function renderGuestSelfProfile() {
  const nameEl = document.getElementById('profName');
  const badgeEl = document.getElementById('badgeContainer');
  const bioEl = document.getElementById('profBio');
  const ratingEl = document.getElementById('profRating');
  const levelEl = document.getElementById('profLevel');
  const rankEl = document.getElementById('rankDisplay');
  const box = document.getElementById('avatarBox');
  const statusEl = document.getElementById('statusIndicator');

  if (nameEl) {
    nameEl.innerText = "GUEST DRIVER";
    nameEl.classList.remove('admin-glow', 'vip-glow');
  }

  // Значок гостя не отображаем
  if (badgeEl) {
    badgeEl.innerHTML = '';
  }

  if (bioEl) {
    bioEl.innerHTML = `
      You are browsing as a guest.
      <a href="auth.html" style="color: var(--nfs-yellow, #f1c40f); font-weight: bold; text-decoration: none;">Log in</a>
      or create an account to unlock your career, garage, and leaderboard rank.
    `;
  }

  if (ratingEl) ratingEl.innerText = '★ 0';
  if (levelEl) levelEl.innerText = '—';
  if (rankEl) rankEl.innerText = '(UNRANKED)';

  if (box) {
    box.innerHTML = `<span class="avatar-letter" style="color: #666;">?</span>`;
  }

  if (statusEl) {
    statusEl.innerHTML = '<div>GUEST MODE</div>';
    statusEl.className = 'status-badge status-offline';
  }

  // Скрываем все кнопки действий
  const editBtn = document.getElementById('editBtn');
  const statusSelect = document.getElementById('statusSelect');
  const addCarBtn = document.getElementById('addCarBtn');
  const msgBtn = document.getElementById('msgBtn');
  const friendBtn = document.getElementById('friendBtn');
  const adminMuteBtn = document.getElementById('adminMuteBtn');

  if (editBtn) editBtn.classList.add('hidden');
  if (statusSelect) statusSelect.classList.add('hidden');
  if (addCarBtn) addCarBtn.classList.add('hidden');
  if (msgBtn) msgBtn.classList.add('hidden');
  if (friendBtn) friendBtn.classList.add('hidden');
  if (adminMuteBtn) adminMuteBtn.classList.add('hidden');

  // Контрастный и читаемый блок закрытого гаража
  const garage = document.getElementById('garageContainer');
  if (garage) {
    garage.innerHTML = `
      <div style="
        text-align: center;
        padding: 35px 20px;
        background: rgba(10, 10, 12, 0.85);
        border: 1px solid rgba(241, 196, 15, 0.35);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.9);
        backdrop-filter: blur(8px);
        margin: 20px auto;
        max-width: 480px;
      ">
        <p style="
          color: #fff;
          font-size: 0.95rem;
          letter-spacing: 1px;
          text-transform: uppercase;
          text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
          margin: 0 0 16px 0;
          font-weight: 600;
        ">
          Personal garage is locked for guests.
        </p>
        <a href="auth.html" class="nfs-font" style="
          display: inline-block;
          color: var(--nfs-yellow, #f1c40f);
          border: 1px solid var(--nfs-yellow, #f1c40f);
          padding: 8px 20px;
          text-decoration: none;
          font-size: 0.8rem;
          font-weight: bold;
          letter-spacing: 1.5px;
          background: rgba(0, 0, 0, 0.6);
          transition: 0.2s;
        "
        onmouseover="this.style.background='var(--nfs-yellow, #f1c40f)'; this.style.color='#000';"
        onmouseout="this.style.background='rgba(0, 0, 0, 0.6)'; this.style.color='var(--nfs-yellow, #f1c40f)';">
          JOIN SAFE-HOUSE
        </a>
      </div>
    `;
  }
}

window.updateLiveStatusUI = function () {
  const el = document.getElementById('statusIndicator');
  if (!el || !window.profileData) return;

  const presence = (typeof onlineUsers !== 'undefined' ? onlineUsers[window.profileData.username] : null);
  const isItMe = (!window.myProfile?.isGuest && window.myProfile && window.profileData.id === window.myProfile.id);

  let s = 'ONLINE';
  if (isItMe) {
    s = localStorage.getItem('driver_status') || 'ONLINE';
  } else if (presence && presence[0] && presence[0].status) {
    s = presence[0].status;
  } else {
    s = window.profileData.status || 'ONLINE';
  }

  if (!presence && !isItMe) {
    let lastSeenTime = "long ago";
    if (window.profileData.last_seen && typeof formatLastSeen === 'function') {
      lastSeenTime = formatLastSeen(window.profileData.last_seen);
    }
    el.innerHTML = `<div>Currently Offline</div><div style="font-size: 1.05rem; font-weight: normal; color: #8f98a0; margin-top: 2px;">Last Online ${lastSeenTime}</div>`;
    el.className = 'status-badge status-offline';
  } else {
    if (s === 'LOOKING FOR GAME') {
      el.innerHTML = `<div>LFG</div>`;
      el.className = 'status-badge status-ingame';
    } else {
      el.innerHTML = '<div>Currently Online</div>';
      el.className = 'status-badge status-online';
    }
  }
};

async function loadMyOwnProfile(userId) {
  try {
    const { data, error } = await _supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) throw error;
    if (data) {
      window.profileData = data;
      const currentLocal = localStorage.getItem('driver_status') || 'ONLINE';
      window.profileData.status = currentLocal;

      setupProfileRealtimeListener();
      renderFullProfile(window.profileData, true);
      updateRacerRank(data.id);
    }
  } catch (err) {
    console.error("Error loading your profile:", err);
    const profName = document.getElementById('profName');
    if (profName) profName.innerText = "ERROR!";
  }
}

async function updateRacerRank(targetUserId) {
  const { data: racers } = await _supabase.from('profiles').select('id').order('rating', { ascending: false });
  if (racers) {
    const rank = racers.findIndex(r => r.id === targetUserId) + 1;
    const rankEl = document.getElementById('rankDisplay');
    if (rankEl) rankEl.innerText = `(#${rank})`;
  }
}

function getMuteRemainingText(mutedUntilDate) {
  const diffMs = new Date(mutedUntilDate) - new Date();
  if (diffMs <= 0) return null;

  const totalMinutes = Math.ceil(diffMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const remainingMinutes = totalMinutes % 60;

  if (days > 0) return `${days} d. ${hours} h.`;
  if (hours > 0) return `${hours} h. ${remainingMinutes} min.`;
  return `${remainingMinutes} min.`;
}

function renderFullProfile(data, isMine) {
  const nameEl = document.getElementById('profName');
  const badgeEl = document.getElementById('badgeContainer');
  const frameEl = document.getElementById('avatarFrame');

  if (frameEl) {
    frameEl.className = 'avatar-container';
    if (data.selected_frame) frameEl.classList.add(data.selected_frame);
    else if (data.username === 'Davenport' || data.username === 'test1') frameEl.classList.add('frame-mw');
    else if (data.is_admin) frameEl.classList.add('frame-admin');
    else if (data.is_mod) frameEl.classList.add('frame-mod');
    else if (data.is_vip) frameEl.classList.add('frame-vip');
    else frameEl.classList.add('frame-default');
  }

  const isMuted = data.muted_until && new Date(data.muted_until) > new Date();

  const oldMuteBanner = document.getElementById('muteInfoSubtext');
  if (oldMuteBanner) oldMuteBanner.remove();

  if (nameEl) {
    nameEl.innerText = data.username;
    nameEl.classList.remove('admin-glow', 'vip-glow');

    if (data.is_admin) {
      nameEl.classList.add('admin-glow');
    } else if (data.is_vip) {
      nameEl.classList.add('vip-glow');
    }

    if (isMuted) {
      const remainingTimeStr = getMuteRemainingText(data.muted_until);
      const muteBanner = document.createElement('div');
      muteBanner.id = 'muteInfoSubtext';
      muteBanner.style.cssText = `
        font-size: 0.85rem;
        color: #ff4d4d;
        font-weight: bold;
        letter-spacing: 1px;
        margin-top: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: 'Arial', sans-serif;
      `;
      muteBanner.innerHTML = `⚠️ MUTED (left: <span style="color: #fff;">${remainingTimeStr}</span>)`;
      nameEl.parentNode.insertBefore(muteBanner, nameEl.nextSibling);
    }

    if (badgeEl) {
      let badgesHTML = '';
      if (data.is_admin) badgesHTML += `<span class="badge badge-admin">ADM</span> `;
      if (data.is_vip) badgesHTML += `<span class="badge badge-vip">VIP</span> `;
      badgeEl.innerHTML = badgesHTML;
    }
  }

  const adminMuteBtn = document.getElementById('adminMuteBtn');
  if (adminMuteBtn) {
    if (window.myProfile && !window.myProfile.isGuest && window.myProfile.is_admin && !isMine) {
      adminMuteBtn.classList.remove('hidden');
      adminMuteBtn.innerText = isMuted ? 'UNMUTE / EXTEND' : 'MUTE USER';
    } else {
      adminMuteBtn.classList.add('hidden');
    }
  }

  const bioEl = document.getElementById('profBio');
  if (bioEl) bioEl.innerText = data.bio || "Elite racer of Rockport";

  const ratingEl = document.getElementById('profRating');
  if (ratingEl) ratingEl.innerText = `★ ${data.rating ? data.rating.toLocaleString() : 0}`;

  const levelEl = document.getElementById('profLevel');
  if (levelEl) levelEl.innerText = data.level || 1;

  const box = document.getElementById('avatarBox');
  if (box) {
    box.innerHTML = data.avatar_url ? `<img src="${data.avatar_url}">` : `<span class="avatar-letter">${data.username ? data.username[0].toUpperCase() : '?'}</span>`;
  }

  renderGarage(data.photos);

  const editBtn = document.getElementById('editBtn');
  const statusSelect = document.getElementById('statusSelect');
  const addCarBtn = document.getElementById('addCarBtn');
  const msgBtn = document.getElementById('msgBtn');
  const friendBtn = document.getElementById('friendBtn');

  [editBtn, statusSelect, addCarBtn, msgBtn, friendBtn].forEach(el => {
    if (el) el.style.display = '';
  });

  if (isMine && !window.myProfile?.isGuest) {
    if (editBtn) editBtn.classList.remove('hidden');
    if (addCarBtn) addCarBtn.classList.remove('hidden');
    if (statusSelect) {
      statusSelect.classList.remove('hidden');
      statusSelect.value = localStorage.getItem('driver_status') || data.status || 'ONLINE';
    }
    if (msgBtn) msgBtn.classList.add('hidden');
    if (friendBtn) friendBtn.classList.add('hidden');
  } else {
    if (editBtn) editBtn.classList.add('hidden');
    if (addCarBtn) addCarBtn.classList.add('hidden');
    if (statusSelect) statusSelect.classList.add('hidden');

    if (msgBtn) {
      msgBtn.classList.remove('hidden');
      msgBtn.onclick = () => window.goToChat(data.username);
    }
    if (friendBtn) friendBtn.classList.remove('hidden');
  }

  if (typeof window.updateLiveStatusUI === 'function') window.updateLiveStatusUI();
}

function renderGarage(photos) {
  const container = document.getElementById('garageContainer');
  if (!container) return;
  container.innerHTML = photos?.length ? '' : '<p style="color:#aaa; font-style:italic; padding: 15px 0;">Garage is empty...</p>';
  photos?.forEach((url) => {
    container.innerHTML += `<div class="car-card" onclick="viewFullImage('${url}')"><img src="${url}"></div>`;
  });
}

window.viewFullImage = (url) => {
  Swal.fire({
    imageUrl: url,
    showConfirmButton: false,
    showCloseButton: true,
    width: 'auto',
    customClass: { popup: 'nfs-crt-modal' }
  });
};

window.handleAvatarClick = () => {
  if (window.myProfile?.isGuest) return;
  const isMine = window.myProfile && window.profileData && (window.myProfile.id === window.profileData.id);
  if (isMine) {
    document.getElementById('avatarFileInput')?.click();
  }
};

window.handleAvatarFileSelected = async (event) => {
  if (window.myProfile?.isGuest || !window.currentUserId) return;
  const file = event.target.files[0];
  if (!file) return;

  const maxBytes = 15 * 1024 * 1024;
  if (file.size > maxBytes) {
    Swal.fire({
      title: 'FILE TOO LARGE',
      text: 'Avatar image must be under 15 MB.',
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
    event.target.value = '';
    return;
  }

  Swal.fire({
    title: 'UPDATING AVATAR...',
    text: 'Uploading new avatar photo...',
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    customClass: { popup: 'nfs-crt-modal' },
    didOpen: () => {
      Swal.showLoading();
    }
  });

  try {
    const fileExt = file.name.split('.').pop() || 'jpg';
    const cleanFileName = `avatar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt.toLowerCase()}`;
    const filePath = `${window.currentUserId}/${cleanFileName}`;

    const { error: uploadError } = await _supabase.storage
      .from('chat-attachments')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = _supabase.storage
      .from('chat-attachments')
      .getPublicUrl(filePath);

    const { error: dbError } = await _supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', window.currentUserId);

    if (dbError) throw dbError;

    Swal.fire({
      title: 'SUCCESS!',
      text: 'Avatar updated successfully!',
      icon: 'success',
      timer: 1200,
      showConfirmButton: false,
      customClass: { popup: 'nfs-crt-modal' }
    });

    setTimeout(() => location.reload(), 1000);
  } catch (err) {
    console.error('Avatar upload error:', err);
    Swal.fire({
      title: 'ERROR',
      text: err.message || 'Failed to update avatar.',
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
  } finally {
    event.target.value = '';
  }
};

window.handleCarFileSelected = async (event) => {
  if (window.myProfile?.isGuest || !window.currentUserId) return;
  const file = event.target.files[0];
  if (!file) return;

  const maxBytes = 50 * 1024 * 1024;
  if (file.size > maxBytes) {
    Swal.fire({
      title: 'FILE TOO LARGE',
      text: 'Maximum image size is 50 MB.',
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
    event.target.value = '';
    return;
  }

  Swal.fire({
    title: 'PARKING TO GARAGE...',
    text: 'Uploading car photo...',
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    customClass: { popup: 'nfs-crt-modal' },
    didOpen: () => {
      Swal.showLoading();
    }
  });

  try {
    const fileExt = file.name.split('.').pop() || 'jpg';
    const cleanFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt.toLowerCase()}`;
    const filePath = `${window.currentUserId}/${cleanFileName}`;

    const { error: uploadError } = await _supabase.storage
      .from('garage')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = _supabase.storage
      .from('garage')
      .getPublicUrl(filePath);

    const currentPhotos = Array.isArray(window.profileData.photos) ? window.profileData.photos : [];
    const updatedPhotos = [...currentPhotos, publicUrl];

    const { error: dbError } = await _supabase
      .from('profiles')
      .update({ photos: updatedPhotos })
      .eq('id', window.currentUserId);

    if (dbError) throw dbError;

    Swal.fire({
      title: 'SUCCESS!',
      text: 'Car added to your garage!',
      icon: 'success',
      timer: 1500,
      showConfirmButton: false,
      customClass: { popup: 'nfs-crt-modal' }
    });

    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    console.error('Garage upload error:', err);
    Swal.fire({
      title: 'ERROR',
      text: 'Failed to upload image to garage.',
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
  } finally {
    event.target.value = '';
  }
};

window.updateUserStatus = async () => {
  if (window.myProfile?.isGuest || !window.currentUserId) return;
  const s = document.getElementById('statusSelect').value;
  localStorage.setItem('driver_status', s);

  if (window.profileData) window.profileData.status = s;
  if (window.myProfile) window.myProfile.status = s;

  window.updateLiveStatusUI();

  const { error } = await _supabase.from('profiles').update({ status: s }).eq('id', window.currentUserId);
  if (!error && typeof window.trackMyStatus === 'function') {
    await window.trackMyStatus(s);
  }
};

window.openEditProfile = async () => {
  if (window.myProfile?.isGuest || !window.currentUserId) return;

  const frames = [{ id: 'frame-default', name: 'Standart' }, { id: 'frame-mw', name: 'Most Wanted' }];
  let framesHtml = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px;">';
  frames.forEach(f => {
    const isSelected = window.profileData.selected_frame === f.id ? 'border: 2px solid var(--nfs-yellow);' : 'border: 1px solid #333;';
    framesHtml += `<div onclick="selectFrame('${f.id}')" id="${f.id}" class="frame-preview ${f.id}" style="cursor:pointer; padding:10px; ${isSelected} background: rgba(0,0,0,0.5); font-size: 0.7rem; text-align: center;">${f.name.toUpperCase()}</div>`;
  });
  framesHtml += '</div>';

  const { value: formValues } = await Swal.fire({
    html: `
      <p style="font-size:0.8rem; text-align: center; text-transform: uppercase;">BIO:</p>
      <input id="swal-bio" class="swal2-input" value="${window.profileData.bio || ''}" style="background:#111; color:#fff; width:100%; box-sizing:border-box; text-align: center; margin: 10px 0;">
      <p style="margin-top:15px; font-size:0.8rem; text-align: center; text-transform: uppercase;">FRAME SELECTION:</p>
      ${framesHtml}
    `,
    showCancelButton: true,
    confirmButtonText: 'TO SET IT!',
    customClass: { popup: 'nfs-crt-modal' },
    didOpen: () => {
      const confirmBtn = Swal.getConfirmButton();
      if (confirmBtn) {
        confirmBtn.style.border = 'none';
        confirmBtn.style.boxShadow = '0 0 10px rgba(241, 196, 15, 0.5)';
      }
    },
    preConfirm: () => ({
      bio: document.getElementById('swal-bio').value,
      frame: window.tempSelectedFrame || window.profileData.selected_frame
    })
  });

  if (formValues) {
    const { error } = await _supabase.from('profiles').update({
      bio: formValues.bio,
      selected_frame: formValues.frame
    }).eq('id', window.currentUserId);
    if (!error) location.reload();
  }
};

window.selectFrame = (id) => {
  window.tempSelectedFrame = id;
  document.querySelectorAll('.frame-preview').forEach(el => el.style.border = '1px solid #333');
  document.getElementById(id).style.border = '2px solid var(--nfs-yellow)';
};

async function checkFriendshipStatus(targetUserId) {
  const btn = document.getElementById('friendBtn');
  const msgBtn = document.getElementById('msgBtn');

  // Если гость просматривает чужой профиль
  if (window.myProfile?.isGuest) {
    if (btn) {
      btn.classList.remove('hidden');
      btn.innerText = "ADD TO FRIENDS";
      btn.disabled = false;
      btn.onclick = () => {
        if (typeof window.requireAuth === 'function') {
          window.requireAuth(null, "Log in to add racers to your friend list.");
        }
      };
    }
    if (msgBtn) {
      msgBtn.classList.remove('hidden');
      msgBtn.onclick = () => {
        if (typeof window.requireAuth === 'function') {
          window.requireAuth(null, "Log in to send direct messages.");
        }
      };
    }
    return;
  }

  // Если это собственный профиль
  if (!window.myProfile || targetUserId === window.myProfile.id) {
    if (btn) btn.classList.add('hidden');
    if (msgBtn) msgBtn.classList.add('hidden');
    return;
  }

  const { data: request } = await _supabase
    .from('notifications')
    .select('*')
    .or(`and(sender_id.eq.${window.myProfile.id},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${window.myProfile.id})`)
    .maybeSingle();

  if (!btn) return;

  btn.classList.remove('hidden');
  if (msgBtn) msgBtn.classList.remove('hidden');

  if (!request) {
    btn.innerText = "ADD TO FRIENDS";
    btn.style.background = "";
    btn.style.color = "";
    btn.style.border = "";
    btn.disabled = false;
    btn.onclick = () => sendFriendRequest(targetUserId);
  } else if (request.status === 'pending') {
    if (request.sender_id === window.myProfile.id) {
      btn.innerText = "THE REQUEST HAS BEEN SENT";
      btn.disabled = true;
    } else {
      btn.innerText = "ACCEPT THE REQUEST";
      btn.disabled = false;
      btn.onclick = () => acceptFriendRequest(request.id);
    }
  } else if (request.status === 'accepted') {
    btn.innerText = "REMOVE FROM FRIENDS";
    btn.style.background = "#e74c3c";
    btn.style.color = "#fff";
    btn.style.border = "2px solid #c0392b";
    btn.disabled = false;
    btn.onclick = () => removeFriend(request.id);
  }
}

async function sendFriendRequest(targetId) {
  if (window.myProfile?.isGuest) return;
  await _supabase.from('notifications').insert([{
    sender_id: window.myProfile.id,
    receiver_id: targetId,
    sender_name: window.myProfile.username
  }]);
  location.reload();
}

async function acceptFriendRequest(requestId) {
  if (window.myProfile?.isGuest) return;
  await _supabase.from('notifications').update({ status: 'accepted' }).eq('id', requestId);
  location.reload();
}

async function removeFriend(requestId) {
  if (window.myProfile?.isGuest) return;
  await _supabase.from('notifications').delete().eq('id', requestId);
  location.reload();
}

window.openMuteModal = async () => {
  if (!window.myProfile || window.myProfile.isGuest || !window.myProfile.is_admin || !window.profileData) return;

  const isCurrentlyMuted = window.profileData.muted_until && new Date(window.profileData.muted_until) > new Date();

  if (isCurrentlyMuted) {
    const { isConfirmed, isDenied } = await Swal.fire({
      title: 'MODERATION ACTION',
      text: `User is muted until: ${new Date(window.profileData.muted_until).toLocaleString()}`,
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'CHANGE DURATION',
      denyButtonText: 'UNMUTE USER',
      cancelButtonText: 'CANCEL',
      customClass: { popup: 'nfs-crt-modal' }
    });

    if (isDenied) {
      const { error } = await _supabase.from('profiles').update({ muted_until: null }).eq('id', window.profileData.id);
      if (!error) {
        window.profileData.muted_until = null;
        renderFullProfile(window.profileData, window.profileData.id === window.currentUserId);
        Swal.fire({
          title: 'UNMUTED',
          text: 'User restriction removed.',
          icon: 'success',
          timer: 1200,
          showConfirmButton: false,
          customClass: { popup: 'nfs-crt-modal' }
        });
      }
      return;
    }

    if (!isConfirmed) return;
  }

  const { value: minutes } = await Swal.fire({
    title: 'MUTE RACER',
    input: 'select',
    inputOptions: {
      '15': '15 Minutes',
      '60': '1 Hour',
      '1440': '24 Hours',
      '10080': '7 Days'
    },
    inputPlaceholder: 'Select penalty duration',
    showCancelButton: true,
    confirmButtonText: 'APPLY MUTE',
    cancelButtonText: 'CANCEL',
    customClass: { popup: 'nfs-crt-modal' }
  });

  if (minutes) {
    const mutedUntil = new Date(Date.now() + minutes * 60000).toISOString();
    const { error } = await _supabase.from('profiles').update({ muted_until: mutedUntil }).eq('id', window.profileData.id);
    if (!error) {
      window.profileData.muted_until = mutedUntil;
      renderFullProfile(window.profileData, window.profileData.id === window.currentUserId);
      Swal.fire({
        title: 'RESTRICTED',
        text: 'User has been muted successfully.',
        icon: 'success',
        timer: 1200,
        showConfirmButton: false,
        customClass: { popup: 'nfs-crt-modal' }
      });
    }
  }
};

function setupProfileRealtimeListener() {
  if (!window.profileData) return;
  _supabase.removeChannel(_supabase.channel(`profile-db-changes-${window.profileData.id}`));
  _supabase.channel(`profile-db-changes-${window.profileData.id}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'profiles',
      filter: `id=eq.${window.profileData.id}`
    }, (payload) => {
      window.profileData = payload.new;
      const currentLocal = localStorage.getItem('driver_status') || 'ONLINE';
      if (window.myProfile && !window.myProfile.isGuest && payload.new.id === window.myProfile.id) {
        window.profileData.status = currentLocal;
      }
      renderFullProfile(window.profileData, window.profileData.id === window.currentUserId);
      window.updateLiveStatusUI();
    })
    .subscribe();
}

window.goToChat = function(username) {
  if (!username) return;
  if (window.myProfile?.isGuest) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to chat with other drivers.");
    }
    return;
  }
  window.location.href = `chats.html?to=${username}`;
};
