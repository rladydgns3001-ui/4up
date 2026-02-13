/**
 * 기존 포스트의 <style> 태그를 업데이트하는 스크립트
 * - h1(entry-title) 크기 줄이기
 * - 카테고리(cat-links) 숨기기
 */
const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");

// 새 CSS (post.js와 동일)
const NEW_STYLE = '<style>html{scroll-behavior:smooth}.toc-box a:hover{text-decoration:underline!important;color:#764ba2!important}.entry-content p,.post-content p{font-size:19px!important;line-height:1.85!important}.entry-title{font-size:1.5rem!important;line-height:1.3!important}.cat-links{display:none!important}@media(max-width:600px){.entry-content p,.post-content p{font-size:18px!important;line-height:1.8!important}}</style>';

async function getAllPosts() {
  let allPosts = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${WP_URL}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) break;
    const posts = await res.json();
    if (posts.length === 0) break;
    allPosts = allPosts.concat(posts);
    page++;
  }
  return allPosts;
}

async function updatePost(post) {
  let content = post.content.rendered;

  // 기존 <style> 태그 제거하고 새 CSS로 교체
  const styleRegex = /^<style>[\s\S]*?<\/style>/;
  if (styleRegex.test(content)) {
    content = content.replace(styleRegex, NEW_STYLE);
  } else {
    content = NEW_STYLE + content;
  }

  const res = await fetch(`${WP_URL}/wp-json/wp/v2/posts/${post.id}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.log(`  ❌ 실패 (ID: ${post.id}): ${err.substring(0, 100)}`);
    return false;
  }
  return true;
}

async function main() {
  console.log("📄 모든 포스트 조회 중...");
  const posts = await getAllPosts();
  console.log(`📝 총 ${posts.length}개 포스트 발견\n`);

  let updated = 0;
  for (const post of posts) {
    const title = post.title.rendered.substring(0, 40);
    process.stdout.write(`  🔄 [${post.id}] ${title}...`);
    const ok = await updatePost(post);
    if (ok) {
      updated++;
      console.log(" ✅");
    }
  }

  console.log(`\n🎉 완료! ${updated}/${posts.length}개 포스트 업데이트됨`);
}

main().catch(console.error);
