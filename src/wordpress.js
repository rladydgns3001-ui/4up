const axios = require('axios');
const config = require('./config');

class WordPressAPI {
  constructor() {
    this.baseUrl = `${config.WP_SITE_URL}/wp-json/wp/v2`;
    this.auth = {
      username: config.WP_USERNAME,
      password: config.WP_APP_PASSWORD
    };
  }

  // 설정 다시 로드 (설정 변경 후 호출)
  reloadConfig() {
    this.baseUrl = `${config.WP_SITE_URL}/wp-json/wp/v2`;
    this.auth = {
      username: config.WP_USERNAME,
      password: config.WP_APP_PASSWORD
    };
  }

  async testConnection() {
    // 설정 다시 로드
    this.reloadConfig();

    try {
      const response = await axios.get(`${this.baseUrl}/users/me`, {
        auth: this.auth,
        timeout: 10000
      });
      return response.status === 200;
    } catch (error) {
      console.error('연결 오류:', error.message);
      return false;
    }
  }

  async getRecentPosts(count = 10) {
    try {
      const response = await axios.get(`${this.baseUrl}/posts`, {
        params: { per_page: count, status: 'publish' },
        auth: this.auth
      });

      return response.data.map(p => ({
        id: p.id,
        title: p.title.rendered,
        content: p.content.rendered,
        excerpt: p.excerpt.rendered,
        date: p.date,
        link: p.link
      }));
    } catch (error) {
      console.error('글 가져오기 오류:', error.message);
      return [];
    }
  }

  async searchPosts(keyword, count = 5) {
    try {
      const response = await axios.get(`${this.baseUrl}/posts`, {
        params: { search: keyword, per_page: count },
        auth: this.auth
      });

      return response.data.map(p => ({
        id: p.id,
        title: p.title.rendered,
        content: p.content.rendered,
        excerpt: p.excerpt.rendered,
        link: p.link
      }));
    } catch (error) {
      console.error('검색 오류:', error.message);
      return [];
    }
  }

  async createPost(title, content, status = 'draft', categories = null, tags = null) {
    const data = { title, content, status };
    if (categories) data.categories = categories;
    if (tags) data.tags = tags;

    try {
      const response = await axios.post(`${this.baseUrl}/posts`, data, {
        auth: this.auth
      });

      return {
        success: true,
        id: response.data.id,
        link: response.data.link,
        editLink: `${config.WP_SITE_URL}/wp-admin/post.php?post=${response.data.id}&action=edit`
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  async getCategories() {
    try {
      const response = await axios.get(`${this.baseUrl}/categories`, {
        auth: this.auth
      });
      return response.data.map(c => ({ id: c.id, name: c.name }));
    } catch {
      return [];
    }
  }
}

module.exports = WordPressAPI;
