"""Basic connection example.
"""

import redis

r = redis.Redis(
    host='redis-11852.crce220.us-east-1-4.ec2.cloud.redislabs.com',
    port=11852,
    decode_responses=True,
    username="default",
    password="Oi0r5njC8sJreBQI8PEx7f3FhEhUxbCX",
)

success = r.set('foo', 'bar')
# True

result = r.get('foo')
print(result)
# >>> bar

