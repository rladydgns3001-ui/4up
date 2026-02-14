const fs = require("fs");
const path = require("path");

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwsa6_rs7JoSijOn9HfV2I31nL6jRBBJNvn2_jGU1JTukNYuL-pPfqvbtIxpemAQeCN/exec';
const dataPath = path.join(__dirname, "reviews-data.json");

// ============================================
// 예약 후기 → Apps Script 전송 (텔레그램 승인 필요)
// ============================================
async function main() {
  if (!fs.existsSync(dataPath)) {
    console.error("❌ reviews-data.json 파일이 없습니다.");
    console.error("   먼저 node generate-reviews.js 를 실행해주세요.");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  const { currentIndex, reviews } = data;

  if (currentIndex >= reviews.length) {
    console.log("✅ 모든 후기가 이미 업로드되었습니다.");
    console.log(`   총 ${reviews.length}개 완료`);
    process.exit(0);
  }

  const review = reviews[currentIndex];

  console.log(`📝 예약 후기 전송 중... (${currentIndex + 1}/${reviews.length})`);
  console.log(`   이름: ${review.name}`);
  console.log(`   플랜: ${review.plan}`);
  console.log(`   별점: ${review.rating}`);
  console.log(`   내용: ${review.content.substring(0, 50).replace(/\n/g, " ")}...`);

  // Apps Script로 전송 (needsApproval: true → 텔레그램 승인 필요)
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({
      type: 'review',
      needsApproval: true,
      name: review.name,
      plan: review.plan,
      period: review.period,
      rating: review.rating,
      content: review.content,
      keyword: review.keyword || '',
      email: review.email || ''
    })
  });

  const result = await res.text();
  if (result === 'ok') {
    console.log(`\n✅ 텔레그램으로 승인 요청 전송 완료!`);
    console.log(`   → 텔레그램에서 승인하면 자동으로 WordPress에 발행됩니다.`);
  } else {
    console.error(`❌ 전송 실패:`, result);
    process.exit(1);
  }

  // 인덱스 업데이트
  data.currentIndex = currentIndex + 1;
  data.lastPostedAt = new Date().toISOString();
  data.lastPostedReview = review.name;
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`\n📊 진행: ${data.currentIndex}/${reviews.length} (${Math.round((data.currentIndex / reviews.length) * 100)}%)`);

  if (data.currentIndex < reviews.length) {
    console.log(`   다음 후기: ${reviews[data.currentIndex].name}`);
  } else {
    console.log(`🎉 모든 후기 전송 완료!`);
  }
}

main().catch((err) => {
  console.error("❌ 에러:", err);
  process.exit(1);
});
