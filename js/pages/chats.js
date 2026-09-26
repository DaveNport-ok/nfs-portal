import { _supabase } from '../config.js';
import '../widgets.js';
import '../global.js';

let myProfile = null;
let activeChatId = 'global';
let activeChatType = 'public';
let targetUserName = '';
let specialUsers = {};
let typingChannel = null;
let localTypingTimeouts = {};
let selectedFile = null;
let isSending = false;

window.onload = async () => {
  const { data: { user } } = await _supabase.auth.getUser();

  if (user) {
    // 1. АВТОРИЗОВАННЫЙ ПОЛЬЗОВАТЕЛЬ
    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', user.id).single();
    if (profile) {
      profile.isGuest = false;
      myProfile = profile;
      window.myProfile = profile;
      window.currentUserId = user.id;

      const nickEl = document.getElementById('displayNick');
      if (nickEl) nickEl.innerText = myProfile.username;

      if (typeof updateFriendNotifications === 'function') updateFriendNotifications();
      if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, myProfile);
      if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, myProfile.id);
    }
  } else {
    // 2. ГОСТЕВОЙ РЕЖИМ (не выгоняем на auth.html, даем смотреть публичный чат)
    myProfile = {
      id: null,
      username: 'Guest_' + Math.random().toString(36).substring(2, 6),
      isGuest: true,
      status: 'GUEST',
      avatar_url: 'https://via.placeholder.com/34?text=G'
    };
    window.myProfile = myProfile;
    window.currentUserId = null;

    const nickEl = document.getElementById('displayNick');
    if (nickEl) {
      nickEl.innerText = 'GUEST';
      nickEl.style.color = '#888';
    }

    if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, null);

    // Блокируем поля отправки и инпуты для гостей
    lockChatInputsForGuest();
  }

  await fetchSpecialRoles();
  await loadRecentDMs();

  const urlParams = new URLSearchParams(window.location.search);
  const targetName = urlParams.get('to');

  // Гости могут читать только публичный чат
  if (targetName && !myProfile.isGuest) {
    openChatFromURL(targetName);
  } else {
    await loadMessages();
  }

  subscribeToChanges();
  initTypingTracker();
};

/**
 * Ограничение полей ввода чата для гостя
 */
function lockChatInputsForGuest() {
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.querySelector('.send-btn');
  const attachBtn = document.getElementById('attachBtn');

  if (chatInput) {
    chatInput.disabled = true;
    chatInput.placeholder = 'Chat is locked. Log in to start communication...';
    chatInput.style.backgroundColor = '#111';
    chatInput.style.cursor = 'not-allowed';
  }

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';
    sendBtn.style.cursor = 'not-allowed';
    sendBtn.title = 'Authorization required';
  }

  if (attachBtn) {
    attachBtn.style.pointerEvents = 'none';
    attachBtn.style.opacity = '0.3';
  }
}

function getStatusColor(username) {
  if (typeof onlineUsers === 'undefined' || !onlineUsers || !onlineUsers[username]) return '#555555';
  const presence = onlineUsers[username];
  if (!presence || !presence[0]) return '#555555';
  return '#2ecc71';
}

async function fetchSpecialRoles() {
  const { data } = await _supabase.from('profiles').select('id, username, is_admin, is_vip, avatar_url, status');
  if (data) {
    data.forEach(u => specialUsers[u.username] = {
      id: u.id,
      admin: u.is_admin,
      vip: u.is_vip,
      avatar: u.avatar_url,
      status: u.status || 'OFFLINE',
      username: u.username
    });
  }
}

// Выбор файла с валидацией размера и проверкой на гостя
window.handleFileSelected = function (event) {
  if (myProfile?.isGuest) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to share files and screenshots.");
    }
    event.target.value = '';
    return;
  }

  const file = event.target.files[0];
  if (!file) return;

  const maxBytes = 50 * 1024 * 1024; // 50 MB
  if (file.size > maxBytes) {
    Swal.fire({
      title: 'FILE TOO LARGE',
      text: 'File size exceeds the 50 MB limit.',
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
    event.target.value = '';
    return;
  }

  selectedFile = file;
  const attachBtn = document.getElementById('attachBtn');
  if (attachBtn) {
    attachBtn.innerText = '✅';
    attachBtn.style.background = 'var(--nfs-yellow)';
    attachBtn.style.color = '#000';
  }
};

// Загрузка в Supabase Storage
async function uploadChatAttachment(file) {
  if (!myProfile || myProfile.isGuest) throw new Error("Unauthorized");

  const fileExt = file.name.split('.').pop() || 'bin';
  const cleanFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt.toLowerCase()}`;
  const filePath = `${myProfile.id}/${cleanFileName}`;

  const { error } = await _supabase.storage
    .from('chat-attachments')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) throw error;

  const { data } = _supabase.storage
    .from('chat-attachments')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

async function loadRecentDMs() {
  const container = document.getElementById('dmListContainer');
  if (!container) return;

  // Если зашел гость — показываем заглушку в списке личных сообщений
  if (!myProfile || myProfile.isGuest) {
    container.innerHTML = `
    <div style="padding: 25px 15px; text-align: center; color: #666; font-size: 0.75rem;">
      <div style="color: #cca609; font-weight: bold; margin-bottom: 8px;">PRIVATE FREQUENCY</div>
      <div style="font-family: 'Arial', 'Helvetica', sans-serif !important; font-size: 0.8rem; line-height: 1.4; letter-spacing: normal; text-transform: none; color: #888;">
        Direct messages are available to registered drivers only.
      </div>
      <a href="auth.html" style="color: var(--nfs-yellow, #f1c40f); font-weight: bold; text-decoration: none; display: inline-block; margin-top: 10px;">LOG IN</a>
    </div>
  `;
    return;
  }

  try {
    const { data, error } = await _supabase.from('direct_messages')
      .select('*')
      .or(`sender_id.eq.${myProfile.id},receiver_id.eq.${myProfile.id}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const contacts = new Map();
    if (data) {
      data.forEach(m => {
        const otherId = (m.sender_id === myProfile.id) ? m.receiver_id : m.sender_id;
        const otherName = (m.sender_id === myProfile.id) ? m.receiver_name : m.sender_name;

        if (otherId && otherId !== myProfile.id) {
          if (!contacts.has(otherId)) {
            const uData = specialUsers[otherName] || { avatar: null };
            contacts.set(otherId, {
              name: otherName,
              avatar: uData.avatar,
              lastMsg: m.text || '📎 Attachment',
              unreadCount: 0
            });
          }
          if (m.receiver_id === myProfile.id && m.is_read === false) {
            if (activeChatType !== 'private' || String(activeChatId) !== String(m.sender_id)) {
              contacts.get(otherId).unreadCount++;
            }
          }
        }
      });
    }

    container.innerHTML = contacts.size > 0 ? '' : '<p style="padding: 20px; font-size: 0.8rem; color: #444;">No active dialogs</p>';

    contacts.forEach((val, id) => {
      const borderColor = getStatusColor(val.name);
      const active = activeChatType === 'private' && String(activeChatId) === String(id);

      container.innerHTML += `
        <div id="chat-${id}" class="chat-item ${active ? 'active' : ''}" onclick="switchChat('${id}', '${val.name}', 'private')">
          <div class="avatar-wrapper">
            <div class="chat-avatar" style="border-width: 2px; border-color: ${borderColor};">
              ${val.avatar ? `<img src="${val.avatar}">` : (val.name ? val.name[0] : 'U')}
            </div>
          </div>
          <div class="chat-item-info">
            <div style="font-weight: bold; color: #ffffff">${val.name}</div>
            <div class="chat-item-preview-text">${val.lastMsg ? val.lastMsg.substring(0, 20) : ''}</div>
          </div>
          ${val.unreadCount > 0 ? `<div class="unread-badge">${val.unreadCount}</div>` : ''}
        </div>`;
    });
  } catch (err) {
    console.error("Error loading DMs:", err);
  }
}

window.switchChat = async (id, name, type) => {
  // Гость не может открывать личные чаты
  if (type === 'private' && myProfile?.isGuest) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Direct messages require racer authorization.");
    }
    return;
  }

  activeChatId = id;
  activeChatType = type;
  targetUserName = name;

  const titleEl = document.getElementById('chatWithTitle');
  if (titleEl) titleEl.innerHTML = `<span class="back-to-chats-btn" onclick="closeMobileChat(event)">&larr; </span>${name}`;

  const appContainer = document.querySelector('.app-container');
  if (appContainer) appContainer.classList.add('mobile-chat-open');

  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));

  if (type === 'private') {
    document.getElementById(`chat-${id}`)?.classList.add('active');
    if (myProfile?.id) {
      await _supabase.from('direct_messages').update({ is_read: true }).eq('sender_id', id).eq('receiver_id', myProfile.id);
    }
  } else {
    document.getElementById('publicChatBtn')?.classList.add('active');
  }

  if (typingChannel) typingChannel.unsubscribe();
  initTypingTracker();

  await loadMessages();
  if (!myProfile?.isGuest) {
    await loadRecentDMs();
    if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, myProfile.id);
  }
};

window.closeMobileChat = (e) => {
  if (e) e.stopPropagation();
  document.querySelector('.app-container')?.classList.remove('mobile-chat-open');
};

async function loadMessages() {
  const box = document.getElementById('msgBox');
  if (!box) return;
  box.innerHTML = '';

  let query = null;

  if (activeChatType === 'public') {
    query = _supabase.from('messages').select('*').eq('room_id', 'global');
  } else if (!myProfile?.isGuest && myProfile?.id) {
    query = _supabase.from('direct_messages').select('*').or(`and(sender_id.eq.${myProfile.id},receiver_id.eq.${activeChatId}),and(sender_id.eq.${activeChatId},receiver_id.eq.${myProfile.id})`);
  } else {
    return;
  }

  const { data } = await query.order('created_at', { ascending: true });
  if (data) data.forEach(m => renderSingleMessage(m));
}

function renderSingleMessage(msg) {
  const box = document.getElementById('msgBox');
  if (!box) return;

  const existingMsg = document.getElementById(`msg-${msg.id}`);
  if (existingMsg) {
    const textNode = existingMsg.querySelector('.msg-text');
    if (textNode) textNode.innerText = msg.text || '';
    return;
  }

  const sender = msg.sender_name;
  const isMine = (!myProfile?.isGuest && myProfile?.id && msg.sender_id === myProfile.id) ||
    (!myProfile?.isGuest && sender === myProfile?.username);
  const userData = specialUsers[sender] || { admin: false, avatar: null };
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const color = getStatusColor(sender);

  let actionTools = '';
  if (!myProfile?.isGuest && (isMine || myProfile?.is_admin)) {
    actionTools = `
      <span class="edit-btn" style="cursor:pointer; margin-left:6px; opacity:0.7;" onclick="editMessage('${msg.id}', '${activeChatType}')">[✎]</span>
      <span class="del-btn" style="cursor:pointer; margin-left:4px; opacity:0.7; color:#ff4757;" onclick="deleteMessage('${msg.id}', '${activeChatType}')">[X]</span>
    `;
  }

  const avatarHTML = userData.avatar
    ? `<img src="${userData.avatar}" class="mini-avatar">`
    : `<div class="mini-avatar">${sender ? sender[0].toUpperCase() : 'U'}</div>`;

  let mediaHTML = '';
  if (msg.file_url) {
    if (msg.file_url.match(/\.(mp4|webm|mov)$/i)) {
      mediaHTML = `<video src="${msg.file_url}" controls style="max-width: 100%; max-height: 280px; border-radius: 4px; margin-top: 8px; display: block;"></video>`;
    } else {
      mediaHTML = `<img src="${msg.file_url}" style="max-width: 100%; max-height: 280px; border-radius: 4px; margin-top: 8px; cursor: zoom-in; display: block; border: 1px solid #333;" onclick="viewFullImage('${msg.file_url}')">`;
    }
  }

  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${isMine ? 'outgoing' : 'incoming'}`;
  msgDiv.id = `msg-${msg.id}`;
  msgDiv.innerHTML = `
    <div class="msg-info">
      <div class="avatar-wrapper" onclick="window.location.href='profile.html?u=${sender}'">
        ${avatarHTML}
        <span class="status-square" style="background: ${color};"></span>
      </div>
      <span class="racer-link ${userData.admin ? 'admin-glow' : ''}" onclick="window.location.href='profile.html?u=${sender}'">${sender}</span>
      ${userData.admin ? '<span class="badge-admin">ADM</span>' : ''} • ${time} ${actionTools}
    </div>
    ${msg.text ? `<div class="msg-text">${msg.text}</div>` : ''}
    ${mediaHTML}`;
  box.appendChild(msgDiv);
  box.scrollTop = box.scrollHeight;
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

function initTypingTracker() {
  if (!myProfile) return;

  const channelKey = activeChatType === 'public'
    ? 'global'
    : (myProfile.isGuest ? 'guest' : [myProfile.id, activeChatId].sort().join('-'));

  typingChannel = _supabase.channel(`typing:${channelKey}`);

  typingChannel
    .on('broadcast', { event: 'typing' }, (payload) => {
      const userName = payload.payload.user;
      if (userName === myProfile.username) return;

      const indicator = document.getElementById('typingIndicator');
      if (indicator) indicator.innerText = userName + " is typing...";

      clearTimeout(localTypingTimeouts[userName]);
      localTypingTimeouts[userName] = setTimeout(() => {
        if (indicator) indicator.innerText = "";
      }, 2500);
    })
    .subscribe();

  // Только авторизованные гонщики отправляют индикатор набора текста
  const chatInput = document.getElementById('chatInput');
  if (chatInput && !myProfile.isGuest) {
    chatInput.oninput = () => {
      typingChannel.send({ type: 'broadcast', event: 'typing', payload: { user: myProfile.username } });
    };
  }
}

window.doSendMessage = async () => {
  // Защита от гостей
  if (!myProfile || myProfile.isGuest) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to broadcast messages in chat.");
    }
    return;
  }

  if (isSending) return;

  const input = document.getElementById('chatInput');
  const sendBtn = document.querySelector('.send-btn');
  const attachBtn = document.getElementById('attachBtn');
  const text = input ? input.value.trim() : '';

  if (!text && !selectedFile) return;

  if (myProfile?.muted_until && new Date(myProfile.muted_until) > new Date()) {
    Swal.fire({
      title: 'OOOPS!',
      text: 'Access blocked (Muted).',
      icon: 'error',
      background: '#0a0a0a',
      color: '#fff'
    });
    return;
  }

  isSending = true;
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerText = 'UPLOADING...';
    sendBtn.style.opacity = '0.6';
  }

  let fileUrl = null;

  try {
    if (selectedFile) {
      fileUrl = await uploadChatAttachment(selectedFile);
    }

    const table = activeChatType === 'public' ? 'messages' : 'direct_messages';
    const payload = activeChatType === 'public'
      ? { sender_name: myProfile.username, text: text, file_url: fileUrl, room_id: 'global' }
      : {
        sender_id: myProfile.id,
        receiver_id: activeChatId,
        sender_name: myProfile.username,
        receiver_name: targetUserName,
        text: text,
        file_url: fileUrl
      };

    const { data, error } = await _supabase.from(table).insert([payload]).select();

    if (error) throw error;

    if (data && data.length > 0) {
      renderSingleMessage(data[0]);
      if (input) input.value = '';

      selectedFile = null;
      const fileInput = document.getElementById('chatFileInput');
      if (fileInput) fileInput.value = '';
      if (attachBtn) {
        attachBtn.innerText = '📎';
        attachBtn.style.background = '';
        attachBtn.style.color = '';
      }

      if (activeChatType === 'private') loadRecentDMs();
    }
  } catch (err) {
    console.error('Send error:', err);
    Swal.fire({
      title: 'ERROR',
      text: 'Failed to send message/file. Check connection.',
      icon: 'error',
      background: '#0a0a0a',
      color: '#fff'
    });
  } finally {
    isSending = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerText = 'ENTER';
      sendBtn.style.opacity = '1';
    }
  }
};

window.deleteMessage = async (id, type) => {
  if (myProfile?.isGuest) return;

  const result = await Swal.fire({
    title: 'DELETE MESSAGE?',
    text: 'This action cannot be undone.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ff4757',
    cancelButtonColor: '#333',
    confirmButtonText: 'Yes, delete',
    cancelButtonText: 'Cancel',
    customClass: { popup: 'nfs-crt-modal' }
  });

  if (!result.isConfirmed) return;

  const table = (type === 'public') ? 'messages' : 'direct_messages';
  const { error } = await _supabase.from(table).delete().eq('id', id);

  if (error) {
    Swal.fire({
      title: 'ERROR',
      text: error.message,
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
    return;
  }

  document.getElementById(`msg-${id}`)?.remove();
  if (type === 'private') await loadRecentDMs();
};

window.editMessage = async (id, type) => {
  if (myProfile?.isGuest) return;

  const msgEl = document.getElementById(`msg-${id}`);
  const textNode = msgEl ? msgEl.querySelector('.msg-text') : null;
  const currentText = textNode ? textNode.innerText : '';

  const { value: newText } = await Swal.fire({
    title: 'EDIT MESSAGE',
    input: 'textarea',
    inputValue: currentText,
    showCancelButton: true,
    confirmButtonText: 'SAVE',
    cancelButtonText: 'CANCEL',
    customClass: { popup: 'nfs-crt-modal' },
    inputValidator: (value) => {
      if (!value || !value.trim()) {
        return 'Message text cannot be empty!';
      }
    }
  });

  if (!newText || newText.trim() === currentText) return;

  const table = (type === 'public') ? 'messages' : 'direct_messages';
  const { error } = await _supabase.from(table).update({ text: newText.trim() }).eq('id', id);

  if (error) {
    Swal.fire({
      title: 'ERROR',
      text: error.message,
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
    return;
  }

  if (textNode) textNode.innerText = newText.trim();
  if (type === 'private') await loadRecentDMs();
};

function subscribeToChanges() {
  // Публичный канал сообщений слушают ВСЕ, включая гостей
  _supabase.channel('msgs')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
      if (activeChatType === 'public') renderSingleMessage(p.new);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, p => {
      if (activeChatType === 'public') {
        const textNode = document.querySelector(`#msg-${p.new.id} .msg-text`);
        if (textNode) textNode.innerText = p.new.text || '';
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, p => {
      document.getElementById(`msg-${p.old.id}`)?.remove();
    })
    .subscribe();

  // Личные сообщения слушают ТОЛЬКО авторизованные пользователи
  if (!myProfile?.isGuest && myProfile?.id) {
    _supabase.channel('dms')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages'
      }, async (p) => {
        if (p.new.receiver_id === myProfile.id || p.new.sender_id === myProfile.id) {
          if (activeChatType === 'private' && (p.new.sender_id === activeChatId || p.new.sender_id === myProfile.id)) {
            renderSingleMessage(p.new);
            if (p.new.sender_id === activeChatId) {
              await _supabase.from('direct_messages').update({ is_read: true }).eq('id', p.new.id);
            }
          }
          await loadRecentDMs();
          if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, myProfile.id);
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'direct_messages'
      }, async (p) => {
        if (activeChatType === 'private') {
          const textNode = document.querySelector(`#msg-${p.new.id} .msg-text`);
          if (textNode) textNode.innerText = p.new.text || '';
        }
        await loadRecentDMs();
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'direct_messages'
      }, async (p) => {
        document.getElementById(`msg-${p.old.id}`)?.remove();
        await loadRecentDMs();
      })
      .subscribe();
  }
}

async function openChatFromURL(targetName) {
  if (!targetName || myProfile?.isGuest) return;
  if (Object.keys(specialUsers).length === 0) await fetchSpecialRoles();
  const racer = specialUsers[targetName];
  if (racer) {
    window.switchChat(racer.id, racer.username, 'private');
  } else {
    const { data } = await _supabase.from('profiles').select('id, username').eq('username', targetName).maybeSingle();
    if (data) window.switchChat(data.id, data.username, 'private');
  }
}

window.updateFriendsStatusOnly = loadRecentDMs;
window.loadRecentDMs = loadRecentDMs;
