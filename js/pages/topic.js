import { _supabase } from '../config.js';
import '../widgets.js';
import '../global.js';

const urlParams = new URLSearchParams(window.location.search);
const topicId = urlParams.get('id');

let myName = "";
let currentUserId = null;
let topicData = null;

window.onload = async () => {
  const { data: { user } } = await _supabase.auth.getUser();

  if (user) {
    // 1. АВТОРИЗОВАННЫЙ ПОЛЬЗОВАТЕЛЬ
    currentUserId = user.id;
    window.currentUserId = user.id;

    const { data: prof } = await _supabase.from('profiles').select('id, username, status').eq('id', user.id).single();
    if (prof) {
      prof.isGuest = false;
      myName = prof.username;
      window.myProfile = prof;

      if (typeof initGlobalStatus === 'function') {
        initGlobalStatus(_supabase, prof);
      }
      if (typeof updateFriendNotifications === 'function') {
        updateFriendNotifications();
      }
      if (typeof updateGlobalMsgBadge === 'function') {
        updateGlobalMsgBadge(_supabase, prof.id);
      }
    }
  } else {
    // 2. ГОСТЕВОЙ РЕЖИМ (не перенаправляем, разрешаем чтение)
    currentUserId = null;
    window.currentUserId = null;
    myName = "";

    window.myProfile = {
      id: null,
      username: 'Guest_' + Math.random().toString(36).substring(2, 6),
      isGuest: true,
      status: 'GUEST',
      avatar_url: 'https://via.placeholder.com/34?text=G'
    };

    if (typeof initGlobalStatus === 'function') {
      initGlobalStatus(_supabase, null);
    }

    lockCommentFormForGuest();
  }

  await loadFullTopic();
  await loadComments();
};

/**
 * Блокировка формы комментирования для гостей
 */
function lockCommentFormForGuest() {
  const textarea = document.getElementById('commentText');
  const submitBtn = document.querySelector('button[onclick="postComment()"]') ||
    document.querySelector('.post-comment-btn');

  if (textarea) {
    textarea.disabled = true;
    textarea.placeholder = 'Log in to join discussion and reply to racers...';
    textarea.style.backgroundColor = '#141414';
    textarea.style.cursor = 'not-allowed';
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.style.cursor = 'not-allowed';
    submitBtn.title = 'Authorization required';
  }
}

function getOnlineDotHTML(username) {
  const isOnline = (typeof onlineUsers !== 'undefined') && onlineUsers[username];
  return isOnline ? `<span style="display: inline-block; width: 8px; height: 8px; background-color: #2ecc71; border-radius: 50%; box-shadow: 0 0 6px #2ecc71;"></span>` : '';
}

function formatCommentText(text, currentUserName) {
  if (!text) return "";
  return text.replace(/\[reply:(.+?)\]/g, (match, username) => {
    const cleanNick = username.trim();
    const color = (currentUserName && cleanNick.toLowerCase() === currentUserName.toLowerCase()) ? '#00ff66' : '#666';
    return `<span style="color: ${color}; font-weight: bold; font-family: 'Arial', sans-serif !important;">@${cleanNick}</span>`;
  });
}

async function loadFullTopic() {
  if (!topicId) {
    document.getElementById('topicDetail').innerHTML = "<h2>Topic ID is missing.</h2>";
    return;
  }

  const { data, error } = await _supabase.from('forum_topics').select('*').eq('id', topicId).single();
  if (error || !data) {
    document.getElementById('topicDetail').innerHTML = "<h2>Topic not found.</h2>";
    return;
  }
  topicData = data;

  const dotHTML = getOnlineDotHTML(data.author_name);
  const dateObj = new Date(data.created_at);
  const topicDate = dateObj.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  document.getElementById('topicDetail').innerHTML = `
    <div class="main-topic" style="position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 15px; border-bottom: 1px solid #222; padding-bottom: 10px;">
         <span style="display: inline-flex; align-items: center; gap: 2px;">
           <span style="font-size: 0.85rem; color: #555; font-family: 'Arial', 'Helvetica', sans-serif !important;">Post author:</span>
           <span style="display: inline-flex; align-items: center; gap: 6px; margin-left: 5px;">
             <span class="racer-link" onclick="window.location.href='profile.html?u=${encodeURIComponent(data.author_name)}'">
               ${data.author_name}
             </span>${dotHTML}
           </span>
         </span>
         <span class="comment-date-clean">${topicDate}</span>
      </div>
      <h1 style="color:var(--nfs-yellow); text-transform: uppercase; font-style: italic; margin-top: 0; font-size: 1.8rem; letter-spacing: 1px;">${data.title}</h1>
      <p class="user-text-content" style="white-space: pre-line; margin-bottom: 0;">${formatCommentText(data.content, myName)}</p>
    </div>
  `;

  // Кнопки редактирования и удаления доступны только автору-пользователю
  if (currentUserId && currentUserId === data.author_id) {
    document.getElementById('authorControls')?.classList.remove('hidden');
  } else {
    document.getElementById('authorControls')?.classList.add('hidden');
  }
}

async function loadComments() {
  if (!topicId) return;

  const { data } = await _supabase.from('forum_comments')
    .select('*')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: true });

  const list = document.getElementById('commentsList');
  if (!list) return;
  list.innerHTML = '<h3 style="border-bottom: 1px solid #222; padding-bottom: 10px; font-style: italic; font-size: 1.1rem; letter-spacing: 1px;">COMMENTS:</h3>';

  if (data && data.length > 0) {
    data.forEach(c => {
      const dateObj = new Date(c.created_at);
      const commentDate = dateObj.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const dotHTML = getOnlineDotHTML(c.author_name);

      list.innerHTML += `
        <div class="comment" style="position: relative;">
          <div class="comment-meta" style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 12px;">
             <span style="display: inline-flex; align-items: center; height: 1.4rem; gap: 6px;">
               <span class="racer-link" style="line-height: 1;" onclick="window.location.href='profile.html?u=${encodeURIComponent(c.author_name)}'">
                 ${c.author_name}
               </span>
               <span style="display: inline-flex; align-items: center; justify-content: center; height: 100%; margin-top: 2px;">
                 ${dotHTML}
               </span>
             </span>
             <span class="comment-date-clean">${commentDate}</span>
          </div>

          <div class="user-text-content" style="white-space: pre-line;">${formatCommentText(c.content, myName)}</div>

          <div style="margin-top: 0px; border-top: 1px solid #1a1a1a; padding-top: 2px;">
            <span onclick="insertReplyTag('${c.author_name}')" style="color: #555; cursor: pointer; font-size: 0.75rem; text-transform: uppercase; font-family: 'Arial', sans-serif; font-weight: bold; transition: color 0.2s;" onmouseover="this.style.color='#00ff66'" onmouseout="this.style.color='#555'">
              [ Reply ]
            </span>
          </div>
        </div>
      `;
    });
  } else {
    list.innerHTML += '<p style="color: #444; font-size: 0.8rem; font-style: italic; padding-left: 5px; font-family: \'Arial\', \'Helvetica\', sans-serif !important;">It`s quiet here for now...</p>';
  }
}

window.postComment = async () => {
  // Защита от гостей
  if (!window.myProfile || window.myProfile.isGuest || !currentUserId) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to post comments.");
    } else {
      alert("You must be logged in to comment.");
    }
    return;
  }

  // Проверка мута
  if (window.myProfile.muted_until && new Date(window.myProfile.muted_until) > new Date()) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'MUTED',
        text: 'You are muted and cannot leave comments.',
        icon: 'error',
        customClass: { popup: 'nfs-crt-modal' }
      });
    } else {
      alert('You are muted and cannot leave comments.');
    }
    return;
  }

  const input = document.getElementById('commentText');
  const text = input ? input.value.trim() : '';
  if (!text) return;

  // 1. Добавляем комментарий
  const { error: commentErr } = await _supabase.from('forum_comments').insert([
    { topic_id: topicId, content: text, author_name: myName }
  ]);

  if (commentErr) {
    console.error('Error inserting comment:', commentErr);
    return;
  }

  input.value = '';
  await loadComments();

  // 2. Уведомление адресату [reply:Username]
  const replyMatch = text.match(/\[reply:\s*([^\]]+)\]/i);
  if (replyMatch) {
    const targetUsername = replyMatch[1].trim();

    if (targetUsername.toLowerCase() !== myName.toLowerCase()) {
      const { data: targetUser, error: userErr } = await _supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', targetUsername)
        .maybeSingle();

      if (userErr) {
        console.error('Error fetching target profile:', userErr);
      }

      if (targetUser && targetUser.id !== currentUserId) {
        const { error: notifErr } = await _supabase.from('notifications').insert([{
          sender_id: currentUserId,
          sender_name: myName,
          receiver_id: targetUser.id,
          type: 'forum_reply',
          topic_id: topicId,
          status: 'pending'
        }]);

        if (notifErr) {
          console.error('Notification error (reply):', notifErr);
        }
      }
    }
  }
};

window.confirmDeleteTopic = async () => {
  if (!currentUserId || window.myProfile?.isGuest) return;

  const result = await Swal.fire({
    title: 'Are you sure to delete this topic?',
    html: `<span class="user-text-content" style="font-family: 'Arial', sans-serif; font-size: 1rem; color: #aaa;">This topic will disappear from the archives forever!</span>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'YES',
    cancelButtonText: 'CANCEL',
    background: '#0a0a0a',
    color: '#fff',
    customClass: { popup: 'nfs-crt-modal' }
  });

  if (result.isConfirmed) {
    await _supabase.from('forum_topics').delete().eq('id', topicId);
    window.location.href = 'forum.html';
  }
};

window.editTopic = async () => {
  if (!topicData || !currentUserId || window.myProfile?.isGuest) return;

  const { value: formValues } = await Swal.fire({
    title: 'EDIT THIS TOPIC',
    background: '#0a0a0a',
    color: '#fff',
    html:
      `<input id="swal-title" class="swal2-input user-text-content" placeholder="Title" value="${topicData.title}" style="background:#111; color:#fff; border:1px solid #444; font-family: 'Arial', sans-serif; width: 100%; box-sizing: border-box; margin: 10px 0;">` +
      `<textarea id="swal-content" class="swal2-textarea user-text-content" placeholder="Content" style="background:#111; color:#fff; border:1px solid #444; height: 150px; font-family: 'Arial', sans-serif; width: 100%; box-sizing: border-box; margin: 10px 0; resize: none;">${topicData.content}</textarea>`,
    confirmButtonText: 'SAVE CHANGES',
    showCancelButton: true,
    cancelButtonText: 'CANCEL',
    customClass: { popup: 'nfs-crt-modal' },
    preConfirm: () => ({
      title: document.getElementById('swal-title').value.trim(),
      content: document.getElementById('swal-content').value.trim()
    })
  });

  if (formValues) {
    const { error } = await _supabase.from('forum_topics')
      .update({ title: formValues.title, content: formValues.content })
      .eq('id', topicId);

    if (!error) loadFullTopic();
  }
};

window.updateFriendsStatusOnly = function () {
  loadFullTopic();
  loadComments();
};

window.insertReplyTag = function (authorName) {
  // Защита от клика гостя по кнопке ответа
  if (!window.myProfile || window.myProfile.isGuest || !currentUserId) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to reply to comments.");
    } else {
      alert("Please log in to reply.");
    }
    return;
  }

  const textarea = document.getElementById('commentText');
  if (!textarea) return;
  textarea.value = `[reply:${authorName.trim()}] ${textarea.value}`;
  textarea.focus();
};
