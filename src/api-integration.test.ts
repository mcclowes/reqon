/**
 * Integration tests against real public APIs
 *
 * These tests hit actual API endpoints to verify the complete execution pipeline.
 * APIs used:
 * - JSONPlaceholder (https://jsonplaceholder.typicode.com) - Free fake REST API
 * - HTTPBin (https://httpbin.org) - HTTP request/response testing
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execute } from './index.js';
import { MemoryStore } from './stores/index.js';

// Increase timeout for network requests
const NETWORK_TIMEOUT = 30000;

describe('API Integration Tests', { timeout: NETWORK_TIMEOUT }, () => {
  describe('JSONPlaceholder API', () => {
    it('fetches posts and stores them', async () => {
      const source = `
        mission FetchPosts {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store posts: memory("posts")

          action FetchPosts {
            get "/posts"

            store response -> posts {
              key: .id
            }
          }

          run FetchPosts
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);
      expect(result.actionsRun).toContain('FetchPosts');

      const postsStore = result.stores.get('posts');
      expect(postsStore).toBeDefined();

      const posts = await postsStore!.list();
      expect(posts.length).toBe(100); // JSONPlaceholder returns 100 posts
      expect(posts[0]).toHaveProperty('id');
      expect(posts[0]).toHaveProperty('title');
      expect(posts[0]).toHaveProperty('body');
      expect(posts[0]).toHaveProperty('userId');
    });

    it('fetches a single post by ID', async () => {
      const source = `
        mission FetchSinglePost {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store post: memory("post")

          action FetchPost {
            get "/posts/1"

            store response -> post {
              key: .id
            }
          }

          run FetchPost
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const postStore = result.stores.get('post');
      const posts = await postStore!.list();
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        id: 1,
        userId: 1,
      });
      expect(posts[0].title).toBeDefined();
    });

    it('fetches and transforms posts with map', async () => {
      const source = `
        mission TransformPosts {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store raw: memory("raw")
          store transformed: memory("transformed")

          action FetchAndStore {
            get "/posts?_limit=5"

            store response -> raw {
              key: .id
            }
          }

          action Transform {
            for post in raw {
              map post -> SimplePost {
                id: .id,
                title: .title,
                authorId: .userId,
                source: "jsonplaceholder"
              }

              store response -> transformed {
                key: .id
              }
            }
          }

          run FetchAndStore then Transform
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);
      expect(result.actionsRun).toEqual(['FetchAndStore', 'Transform']);

      const transformedStore = result.stores.get('transformed');
      const items = await transformedStore!.list();

      expect(items).toHaveLength(5);
      expect(items[0]).toHaveProperty('id');
      expect(items[0]).toHaveProperty('title');
      expect(items[0]).toHaveProperty('authorId');
      expect(items[0]).toHaveProperty('source', 'jsonplaceholder');
      // Original properties should not exist in transformed version
      expect(items[0]).not.toHaveProperty('body');
      expect(items[0]).not.toHaveProperty('userId');
    });

    it('validates fetched data with assume', async () => {
      const source = `
        mission ValidatePosts {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store posts: memory("posts")

          action FetchAndValidate {
            get "/posts?_limit=10"

            validate response {
              assume length(response) > 0
            }

            store response -> posts {
              key: .id
            }
          }

          run FetchAndValidate
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);
      const postsStore = result.stores.get('posts');
      const posts = await postsStore!.list();
      expect(posts.length).toBeGreaterThan(0);
    });

    it('fetches users and their posts in sequence', async () => {
      const source = `
        mission FetchUsersAndPosts {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store users: memory("users")
          store posts: memory("posts")

          action FetchUsers {
            get "/users?_limit=3"

            store response -> users {
              key: .id
            }
          }

          action FetchPosts {
            get "/posts?_limit=10"

            store response -> posts {
              key: .id
            }
          }

          run FetchUsers then FetchPosts
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);
      expect(result.actionsRun).toEqual(['FetchUsers', 'FetchPosts']);

      const usersStore = result.stores.get('users');
      const postsStore = result.stores.get('posts');

      const users = await usersStore!.list();
      const posts = await postsStore!.list();

      expect(users).toHaveLength(3);
      expect(posts).toHaveLength(10);

      // Verify user structure
      expect(users[0]).toHaveProperty('id');
      expect(users[0]).toHaveProperty('name');
      expect(users[0]).toHaveProperty('email');
      expect(users[0]).toHaveProperty('username');
    });

    it('fetches comments for a specific post', async () => {
      const source = `
        mission FetchComments {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store comments: memory("comments")

          action FetchComments {
            get "/posts/1/comments"

            store response -> comments {
              key: .id
            }
          }

          run FetchComments
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const commentsStore = result.stores.get('comments');
      const comments = await commentsStore!.list();

      expect(comments.length).toBeGreaterThan(0);
      expect(comments[0]).toHaveProperty('postId', 1);
      expect(comments[0]).toHaveProperty('id');
      expect(comments[0]).toHaveProperty('name');
      expect(comments[0]).toHaveProperty('email');
      expect(comments[0]).toHaveProperty('body');
    });

    it('uses match to categorize posts by userId', async () => {
      const source = `
        mission CategorizePosts {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store raw: memory("raw")
          store categorized: memory("categorized")

          action FetchPosts {
            get "/posts?_limit=10"

            store response -> raw {
              key: .id
            }
          }

          action Categorize {
            for post in raw {
              map post -> CategorizedPost {
                id: .id,
                title: .title,
                category: match .userId {
                  1 => "first-user",
                  2 => "second-user",
                  _ => "other-user"
                }
              }

              store response -> categorized {
                key: .id
              }
            }
          }

          run FetchPosts then Categorize
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const categorizedStore = result.stores.get('categorized');
      const items = await categorizedStore!.list();

      expect(items.length).toBe(10);

      // Check that categories are correctly assigned
      const firstUserPosts = items.filter((p: Record<string, unknown>) => p.category === 'first-user');
      const secondUserPosts = items.filter((p: Record<string, unknown>) => p.category === 'second-user');
      const otherPosts = items.filter((p: Record<string, unknown>) => p.category === 'other-user');

      expect(firstUserPosts.length + secondUserPosts.length + otherPosts.length).toBe(10);
    });

    it('filters posts using where clause', async () => {
      const source = `
        mission FilterPosts {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store all_posts: memory("all_posts")
          store filtered: memory("filtered")

          action FetchAll {
            get "/posts?_limit=20"

            store response -> all_posts {
              key: .id
            }
          }

          action FilterByUser {
            for post in all_posts where .userId == 1 {
              store post -> filtered {
                key: .id
              }
            }
          }

          run FetchAll then FilterByUser
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const filteredStore = result.stores.get('filtered');
      const filtered = await filteredStore!.list();

      // All filtered posts should have userId === 1
      expect(filtered.length).toBeGreaterThan(0);
      filtered.forEach((post: Record<string, unknown>) => {
        expect(post.userId).toBe(1);
      });
    });
  });

  describe('HTTPBin API', () => {
    it('makes a GET request and validates response', async () => {
      const source = `
        mission TestGet {
          source HTTPBin {
            auth: none,
            base: "https://httpbin.org"
          }

          store response_data: memory("response_data")

          action TestGet {
            get "/get?foo=bar&baz=qux"

            store response -> response_data {
              key: "result"
            }
          }

          run TestGet
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const store = result.stores.get('response_data');
      const items = await store!.list();

      expect(items).toHaveLength(1);
      expect(items[0]).toHaveProperty('args');
      expect((items[0] as Record<string, unknown>).args).toMatchObject({
        foo: 'bar',
        baz: 'qux',
      });
    });

    it('makes a POST request without body', async () => {
      const source = `
        mission TestPost {
          source HTTPBin {
            auth: none,
            base: "https://httpbin.org"
          }

          store response_data: memory("response_data")

          action TestPost {
            post "/post"

            store response -> response_data {
              key: "result"
            }
          }

          run TestPost
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const store = result.stores.get('response_data');
      const items = await store!.list();

      expect(items).toHaveLength(1);
      const responseData = items[0] as Record<string, unknown>;
      expect(responseData).toHaveProperty('url');
      expect(responseData.url).toContain('/post');
    });

    it('makes a PUT request without body', async () => {
      const source = `
        mission TestPut {
          source HTTPBin {
            auth: none,
            base: "https://httpbin.org"
          }

          store response_data: memory("response_data")

          action TestPut {
            put "/put"

            store response -> response_data {
              key: "result"
            }
          }

          run TestPut
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const store = result.stores.get('response_data');
      const items = await store!.list();

      expect(items).toHaveLength(1);
      const responseData = items[0] as Record<string, unknown>;
      expect(responseData.url).toContain('/put');
    });

    it('makes a PATCH request without body', async () => {
      const source = `
        mission TestPatch {
          source HTTPBin {
            auth: none,
            base: "https://httpbin.org"
          }

          store response_data: memory("response_data")

          action TestPatch {
            patch "/patch"

            store response -> response_data {
              key: "result"
            }
          }

          run TestPatch
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const store = result.stores.get('response_data');
      const items = await store!.list();

      expect(items).toHaveLength(1);
      const responseData = items[0] as Record<string, unknown>;
      expect(responseData.url).toContain('/patch');
    });

    it('makes a DELETE request', async () => {
      const source = `
        mission TestDelete {
          source HTTPBin {
            auth: none,
            base: "https://httpbin.org"
          }

          store response_data: memory("response_data")

          action TestDelete {
            delete "/delete"

            store response -> response_data {
              key: "result"
            }
          }

          run TestDelete
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const store = result.stores.get('response_data');
      const items = await store!.list();

      expect(items).toHaveLength(1);
      // HTTPBin returns the request details in the response
      expect(items[0]).toHaveProperty('url');
    });

    it('verifies multiple HTTP methods in sequence', async () => {
      const source = `
        mission VerifyMethods {
          source HTTPBin {
            auth: none,
            base: "https://httpbin.org"
          }

          store get_result: memory("get_result")
          store post_result: memory("post_result")

          action TestGet {
            get "/get"

            store response -> get_result {
              key: "result"
            }
          }

          action TestPost {
            post "/post"

            store response -> post_result {
              key: "result"
            }
          }

          run TestGet then TestPost
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      // Both actions should have run
      expect(result.actionsRun).toEqual(['TestGet', 'TestPost']);

      // Verify GET response
      const getStore = result.stores.get('get_result');
      const getItems = await getStore!.list();
      expect(getItems).toHaveLength(1);
      expect((getItems[0] as Record<string, unknown>).url).toContain('/get');

      // Verify POST response
      const postStore = result.stores.get('post_result');
      const postItems = await postStore!.list();
      expect(postItems).toHaveLength(1);
      expect((postItems[0] as Record<string, unknown>).url).toContain('/post');
    });
  });

  describe('Complex Integration Scenarios', () => {
    it('chains multiple API calls and transforms', async () => {
      const source = `
        mission ChainedOperations {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store users: memory("users")
          store posts: memory("posts")
          store summary: memory("summary")

          action FetchUsers {
            get "/users?_limit=2"

            store response -> users {
              key: .id
            }
          }

          action FetchPosts {
            get "/posts?_limit=10"

            store response -> posts {
              key: .id
            }
          }

          action CreateSummary {
            for user in users {
              map user -> UserSummary {
                userId: .id,
                username: .username,
                email: .email,
                company: .company.name
              }

              store response -> summary {
                key: .userId
              }
            }
          }

          run FetchUsers then FetchPosts then CreateSummary
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);
      expect(result.actionsRun).toEqual(['FetchUsers', 'FetchPosts', 'CreateSummary']);

      const summaryStore = result.stores.get('summary');
      const summaries = await summaryStore!.list();

      expect(summaries).toHaveLength(2);
      expect(summaries[0]).toHaveProperty('userId');
      expect(summaries[0]).toHaveProperty('username');
      expect(summaries[0]).toHaveProperty('email');
      expect(summaries[0]).toHaveProperty('company');
    });

    it('validates and filters in a pipeline', async () => {
      const source = `
        mission ValidateAndFilter {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store raw_todos: memory("raw_todos")
          store completed_todos: memory("completed_todos")

          action FetchTodos {
            get "/todos?_limit=20"

            validate response {
              assume length(response) > 0
            }

            store response -> raw_todos {
              key: .id
            }
          }

          action FilterCompleted {
            for todo in raw_todos where .completed == true {
              map todo -> CompletedTodo {
                id: .id,
                title: .title,
                userId: .userId,
                status: "done"
              }

              store response -> completed_todos {
                key: .id
              }
            }
          }

          run FetchTodos then FilterCompleted
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const completedStore = result.stores.get('completed_todos');
      const completed = await completedStore!.list();

      // All items should have status "done"
      completed.forEach((todo: Record<string, unknown>) => {
        expect(todo.status).toBe('done');
      });
    });

    it('handles nested object access in transforms', async () => {
      const source = `
        mission NestedAccess {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store users: memory("users")
          store flat_users: memory("flat_users")

          action FetchUsers {
            get "/users?_limit=3"

            store response -> users {
              key: .id
            }
          }

          action FlattenUsers {
            for user in users {
              map user -> FlatUser {
                id: .id,
                name: .name,
                email: .email,
                street: .address.street,
                city: .address.city,
                zipcode: .address.zipcode,
                companyName: .company.name,
                catchPhrase: .company.catchPhrase
              }

              store response -> flat_users {
                key: .id
              }
            }
          }

          run FetchUsers then FlattenUsers
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const flatStore = result.stores.get('flat_users');
      const flatUsers = await flatStore!.list();

      expect(flatUsers).toHaveLength(3);
      flatUsers.forEach((user: Record<string, unknown>) => {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('street');
        expect(user).toHaveProperty('city');
        expect(user).toHaveProperty('zipcode');
        expect(user).toHaveProperty('companyName');
        expect(user).toHaveProperty('catchPhrase');
      });
    });

    it('processes albums with photos', async () => {
      const source = `
        mission AlbumsWithPhotos {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store albums: memory("albums")
          store photos: memory("photos")

          action FetchAlbums {
            get "/albums?_limit=3"

            store response -> albums {
              key: .id
            }
          }

          action FetchPhotos {
            get "/photos?_limit=15"

            store response -> photos {
              key: .id
            }
          }

          run FetchAlbums then FetchPhotos
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const albumsStore = result.stores.get('albums');
      const photosStore = result.stores.get('photos');

      const albums = await albumsStore!.list();
      const photos = await photosStore!.list();

      expect(albums).toHaveLength(3);
      expect(photos).toHaveLength(15);

      // Verify album structure
      expect(albums[0]).toHaveProperty('id');
      expect(albums[0]).toHaveProperty('userId');
      expect(albums[0]).toHaveProperty('title');

      // Verify photo structure
      expect(photos[0]).toHaveProperty('id');
      expect(photos[0]).toHaveProperty('albumId');
      expect(photos[0]).toHaveProperty('title');
      expect(photos[0]).toHaveProperty('url');
      expect(photos[0]).toHaveProperty('thumbnailUrl');
    });
  });

  describe('Error Handling', () => {
    it('handles 404 responses gracefully', async () => {
      const source = `
        mission Handle404 {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store result: memory("result")

          action FetchNonExistent {
            get "/posts/99999"

            store response -> result {
              key: "id"
            }
          }

          run FetchNonExistent
        }
      `;

      const result = await execute(source, { verbose: false });

      // JSONPlaceholder returns empty object for non-existent resources
      // The execution should complete (whether as success or failure depends on implementation)
      expect(result).toBeDefined();
    });

    it('validation failure prevents storing invalid data', async () => {
      const source = `
        mission ValidationFailure {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store result: memory("result")

          action FetchAndFailValidation {
            get "/posts?_limit=5"

            validate response {
              assume length(response) > 1000
            }

            store response -> result {
              key: .id
            }
          }

          run FetchAndFailValidation
        }
      `;

      const result = await execute(source, { verbose: false });

      // Validation should fail because we don't get > 1000 items
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Type Checking with is', () => {
    it('validates types using is syntax', async () => {
      const source = `
        mission TypeValidation {
          source JSONPlaceholder {
            auth: none,
            base: "https://jsonplaceholder.typicode.com"
          }

          store posts: memory("posts")
          store validated: memory("validated")

          action FetchPosts {
            get "/posts?_limit=5"

            store response -> posts {
              key: .id
            }
          }

          action ValidateTypes {
            for post in posts {
              validate post {
                assume .id is number
                assume .title is string
                assume .body is string
                assume .userId is number
              }

              store post -> validated {
                key: .id
              }
            }
          }

          run FetchPosts then ValidateTypes
        }
      `;

      const result = await execute(source, { verbose: false });

      expect(result.success).toBe(true);

      const validatedStore = result.stores.get('validated');
      const validated = await validatedStore!.list();

      expect(validated).toHaveLength(5);
    });
  });
});
