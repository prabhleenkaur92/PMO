require "mailtrap"

mail = Mailtrap::Mail::Base.new(
  from:
    {
      email: "hello@demomailtrap.co",
      name: "Mailtrap Test",
    },
  to: [
    {
      email: "kunal@5tattva.com",
    }
  ],
  subject: "You are awesome!",
  text: "Congrats for sending test email with Mailtrap!",
  category: "Integration Test"
)

client = Mailtrap::Client.new(
  api_key: "b68ca5ffc5f5d86470ad39a6d379cb66",
)

response = client.send(mail)
puts response
