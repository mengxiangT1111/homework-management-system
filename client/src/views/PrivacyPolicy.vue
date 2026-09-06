<template>
  <div class="policy-page">
    <div class="policy-doc">
      <div class="policy-head">
        <div class="policy-brand" @click="goBack">信衡 XINHENG</div>
        <h1>用户隐私保护指引</h1>
        <p class="policy-meta">版本号：V1.0　|　生效日期：2026 年 9 月 5 日</p>
      </div>

      <p class="lead">信衡（以下简称"我们"）是在线作业提交与智能批改服务平台，通过网站（mengxiangt.top）及配套微信小程序（以下合称"本平台"）为学校的教学活动提供作业发布、提交、批改与查重服务。本平台由 ICP 备案主体（鲁ICP备2026049690号）运营。</p>
      <p class="lead">我们深知个人信息对您的重要性，将以高度审慎的态度处理您的个人信息，严格按照《中华人民共和国网络安全法》《中华人民共和国个人信息保护法》《中华人民共和国未成年人保护法》等法律法规的要求，通过本指引向您说明我们如何收集、使用、存储、共享和保护您的个人信息，以及您享有的相关权利。</p>
      <p class="lead">请您在使用本平台前仔细阅读并充分理解本指引，<strong>重点内容我们已用加粗方式提示</strong>。您勾选同意本指引、注册账号或登录使用本平台，即表示您已阅读并同意本指引的全部内容。</p>

      <h2>一、适用范围</h2>
      <p>本指引适用于本平台向您提供的全部产品与服务。本指引不适用于其他第三方（包括但不限于接入的云服务、大模型接口服务商）向您提供的服务，第三方向您处理个人信息时适用其自行发布的隐私政策。</p>

      <h2>二、我们如何收集和使用您的信息</h2>
      <p>我们仅收集和用户提供服务所必需的信息，不会收集与教学服务无关的信息。您可自主选择是否提供某些选填信息，但拒绝提供某些信息可能导致无法使用相应功能。</p>

      <h3>1. 账号注册与登录</h3>
      <p>当您注册账号时，需要提供：<strong>所属学校、学号/工号、真实姓名、登录密码、身份角色（学生/教师）</strong>。其中：</p>
      <ul>
        <li>登录密码经不可逆加密后存储，我们无法查看您的原始密码；</li>
        <li>教师账号注册后需经平台管理员审核通过方可使用；</li>
        <li>邮箱为选填项，用于备用联系方式，如您不提供不影响正常使用。</li>
      </ul>
      <p>当您登录时，我们会验证您的账号信息，并为您的设备生成登录凭证（令牌），用于维持登录状态和识别您的身份。</p>

      <h3>2. 教学与作业管理</h3>
      <p>为提供作业发布、提交、批改、查重等核心功能，我们会处理以下信息：</p>
      <ul>
        <li><strong>班级与课程信息</strong>：班级、课程、班级成员与课代表/负责人等关系信息，用于组织教学活动；</li>
        <li><strong>作业信息</strong>：教师发布的作业要求、附件与评分标准，学生提交的作业文件（如文档、图片等）及提交时间、提交记录；</li>
        <li><strong>成绩信息</strong>：人工批改成绩、AI 辅助批改结果（总分、分维度得分、评语、置信度）及教师复核记录；</li>
        <li><strong>查重信息</strong>：为检测作业相似度，我们会在自有服务器上对提交内容进行分析比对，比对结果仅教师可见。</li>
      </ul>

      <h3>3. AI 辅助批改</h3>
      <p>当启用 AI 批改时，我们会将您提交的<strong>作业文本内容</strong>，连同教师设置的<strong>参考答案与评分标准</strong>，通过接口发送给大模型服务进行自动评阅。我们会采取技术措施<strong>确保提交给大模型服务的内容不包含您的姓名、学号等直接身份信息</strong>。AI 批改结果仅作为辅助参考，最终成绩由教师复核确认。</p>

      <h3>4. 通知与待办</h3>
      <p>为向您提醒作业、批改结果、账号审核等事项，我们会通过平台内的消息通知与任务待办功能向您推送相关信息。目前我们不通过短信、电话等方式主动联系您。</p>

      <h3>5. 日志信息</h3>
      <p>为保障服务安全稳定运行，服务器会记录必要的访问日志（如访问时间、请求路径、响应状态等）。我们对日志中的凭证参数进行了脱敏处理，日志仅用于安全审计与故障排查。</p>

      <h2>三、我们如何使用 Cookie 及同类技术</h2>
      <p>为使您获得更便捷的访问体验，登录凭证以令牌形式存储于您设备的浏览器本地存储中。该凭证仅用于维持您的登录状态与身份识别，我们不会将其用于任何与本平台服务无关的用途，也不会通过 Cookie 追踪您的上网行为或进行个性化广告推荐。</p>

      <h2>四、我们如何共享、委托处理您的信息</h2>
      <p><strong>我们不会向任何第三方出售您的个人信息。</strong>仅在以下为实现服务所必需的情形下，我们会委托处理或共享必要的信息：</p>
      <ul>
        <li><strong>云基础设施服务商</strong>：本平台部署于云服务器上，作业文件存储于腾讯云对象存储（COS）。该服务商仅作为我们的技术受托方存储数据，无权将数据用于其他目的；</li>
        <li><strong>大模型接口服务商</strong>：如第 2.3 条所述，AI 批改功能会将作业文本内容、参考答案与评分标准发送给您所使用服务配置的大模型服务商。我们要求该服务商对传输内容予以保密，且不得将其用于模型训练之外未经授权的目的；</li>
        <li><strong>法律要求</strong>：根据法律法规、司法机关或行政机关的强制性要求，在必要范围内提供您的信息。在此之前，我们会要求对方出具合法依据并尽可能依法通知您。</li>
      </ul>
      <p>除上述情形外，未经您单独同意，我们不会向任何第三方提供您的个人信息。</p>

      <h2>五、我们如何存储和保护您的信息</h2>
      <h3>1. 存储地点与期限</h3>
      <p>您的个人信息存储于中华人民共和国境内的服务器。<strong>我们仅在为您提供服务所必需的期限内保存您的信息</strong>：账号信息在您的账号存续期间保存；作业文件与成绩在相应课程教学周期及学校管理需要的期限内保存。超出期限或您注销账号后，我们会对相关数据进行删除或匿名化处理。</p>
      <h3>2. 安全措施</h3>
      <ul>
        <li>全站采用 HTTPS 加密传输，防止数据在传输过程中被窃取；</li>
        <li>密码采用不可逆的加密算法存储；登录采用访问令牌机制，令牌对凭证参数在日志中脱敏；</li>
        <li>作业文件的下载采用按归属校验的鉴权机制，未授权用户无法访问他人的作业文件；</li>
        <li>对数据库实施访问控制与最小权限原则，生产环境凭证与代码分离管理；</li>
        <li>定期开展安全自查与数据备份。</li>
      </ul>
      <h3>3. 安全事件处置</h3>
      <p>如不幸发生个人信息安全事件，我们将按照法律法规要求，及时启动应急预案，采取补救措施防止损失扩大，并以通知、公告等方式告知您事件的详情、可能的影响及您可以采取的应对措施。</p>

      <h2>六、未成年人信息的保护</h2>
      <p>本平台面向学校教学场景提供服务，用户中可能包含未成年人。<strong>我们非常重视未成年人个人信息的保护</strong>：</p>
      <ul>
        <li>不满十四周岁的未成年人使用本平台前，应当由其父母或其他监护人代为阅读本指引，并在征得监护人同意后提供和使用个人信息；</li>
        <li>学校、教师组织学生使用本平台时，应确保已依法取得学生监护人关于个人信息处理的同意；</li>
        <li>我们仅收集教学活动所必需的未成年人信息（如姓名、学号、作业与成绩），并给予更严格的保护；</li>
        <li>如您是未成年人的监护人，对您被监护的未成年人的个人信息处理有任何疑问，或发现我们误收集了未成年人的个人信息，请与我们联系，我们将尽快核实并删除相关数据。</li>
      </ul>

      <h2>七、您的权利</h2>
      <p>按照相关法律法规，您对您的个人信息享有以下权利：</p>
      <ul>
        <li><strong>访问与更正</strong>：您可以在"个人中心"查看您的账号资料，并对邮箱等资料进行修改；</li>
        <li><strong>删除</strong>：在符合平台功能设计与教学管理规范的前提下，您可以删除作业提交记录；如需删除其他个人信息，您可通过下文方式联系我们；</li>
        <li><strong>注销账号</strong>：您可以通过下文渠道申请注销账号。我们将在核验您的身份后，删除或匿名化您的个人信息；</li>
        <li><strong>撤回同意</strong>：您可以通过注销账号、停止使用本平台等方式撤回同意。撤回同意不影响撤回前基于您同意已进行的信息处理活动的效力；</li>
        <li><strong>投诉与建议</strong>：如您认为我们的个人信息处理行为损害了您的合法权益，您可以通过下文渠道向我们投诉，我们将在 15 个工作日内答复您；您也有权向有关监管部门投诉、举报。</li>
      </ul>

      <h2>八、本指引的更新</h2>
      <p>我们可能适时修订本指引。未经您明确同意，我们不会削减您按照本指引所应享有的权利。重大变更（如收集使用信息的目的、方式和范围发生变化）发生后，我们将在平台显著位置公告或向您推送提示。若您在更新后继续使用本平台，即表示您已阅读并同意受更新后的指引约束。</p>

      <h2>九、如何联系我们</h2>
      <p>如您对本指引或个人信息保护有任何疑问、意见或建议，或需要行使您的个人信息权利，您可以通过以下方式与我们联系：</p>
      <ul>
        <li>运营主体：鲁ICP备2026049690号 备案主体</li>
        <li>联系邮箱：<strong>{{ contactEmail }}</strong></li>
      </ul>
      <p>我们将在收到您的请求并核验您的身份后 15 个工作日内予以答复。</p>

      <div class="policy-tail">
        <a class="back-link" @click.prevent="goBack" href="#">返回登录页</a>
        <p class="policy-footer">信衡 XINHENG · 让每一分都可信</p>
        <a class="policy-beian" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">鲁ICP备2026049690号</a>
      </div>
    </div>
  </div>
</template>

<script setup>
// 联系邮箱：上线前务必替换为备案主体的真实联系邮箱
const contactEmail = 'contact@mengxiangt.top'

function goBack() {
  window.location.href = '/login'
}
</script>

<style scoped>
.policy-page {
  min-height: 100vh;
  background:
    radial-gradient(1100px 560px at 82% -10%, rgba(255, 255, 255, 0.5), transparent 60%),
    linear-gradient(150deg, #e8fcf2 0%, #cdf2df 48%, #a4e7c6 100%);
  padding: 48px 16px 40px;
}

.policy-doc {
  max-width: 820px;
  margin: 0 auto;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 64px -20px rgba(16, 80, 52, 0.25);
  padding: 48px 56px 40px;
}

.policy-head { text-align: center; margin-bottom: 28px; }
.policy-brand {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--brand-700);
  cursor: pointer;
  margin-bottom: 18px;
}
.policy-head h1 { font-size: 26px; color: var(--ink-800); margin: 0 0 10px; }
.policy-meta { font-size: 13px; color: var(--ink-500); margin: 0; }

.lead { font-size: 14px; line-height: 1.9; color: var(--ink-700); margin: 0 0 14px; }

h2 {
  font-size: 17px;
  color: var(--brand-800);
  margin: 34px 0 12px;
  padding-left: 12px;
  border-left: 4px solid var(--brand-500);
  line-height: 1.4;
}
h3 { font-size: 14.5px; color: var(--ink-800); margin: 20px 0 8px; }

p { font-size: 14px; line-height: 1.9; color: var(--ink-700); margin: 0 0 10px; }

ul { margin: 0 0 12px; padding-left: 4px; list-style: none; }
li {
  font-size: 14px;
  line-height: 1.9;
  color: var(--ink-700);
  padding-left: 18px;
  position: relative;
}
li::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 0.95em;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-300);
}

strong { color: var(--brand-800); font-weight: 600; }

.policy-tail {
  margin-top: 44px;
  padding-top: 22px;
  border-top: 1px solid var(--ink-200);
  text-align: center;
}
.back-link {
  font-size: 14px;
  color: var(--brand-700);
  font-weight: 550;
  text-decoration: none;
  cursor: pointer;
}
.back-link:hover { text-decoration: underline; }
.policy-footer {
  margin-top: 14px;
  font-size: 12px;
  color: var(--ink-400);
  letter-spacing: 0.02em;
  margin-bottom: 4px;
}
.policy-beian {
  display: inline-block;
  font-size: 12px;
  color: var(--ink-400);
  letter-spacing: 0.02em;
  text-decoration: none;
}
.policy-beian:hover { color: var(--ink-600); }

@media (max-width: 768px) {
  .policy-page { padding: 20px 12px 28px; }
  .policy-doc { padding: 30px 20px 26px; border-radius: 12px; }
  .policy-head h1 { font-size: 22px; }
}
</style>
