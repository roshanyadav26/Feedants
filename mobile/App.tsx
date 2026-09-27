import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { API_BASE_URL } from "./config";

const OTP_REQUEST_TIMEOUT_MS = 90_000;
const STATUS_REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  stage: "send_otp_request" | "verify_otp_request" | "participant_status_request"
): Promise<{ response: Response; responseText: string }> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // Keep the abort timer active while the response body is being received.
    const responseText = await response.text();
    console.info(
      `[otp-timing] stage=${stage} elapsed_ms=${Date.now() - startedAt} outcome=success`
    );
    return { response, responseText };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    console.info(
      `[otp-timing] stage=${stage} elapsed_ms=${Date.now() - startedAt} outcome=${timedOut ? "timeout" : "error"}`
    );
    if (timedOut) {
      throw new Error(
        "The server took too long to respond. It may be waking up after being idle; please try again."
      );
    }
    throw new Error("Could not reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }
}

function readApiResponse(response: Response, responseText: string): any {
  if (!responseText.trim()) {
    throw new Error(
      `Server returned an empty response. HTTP ${response.status}`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(
      `The server returned an unexpected response (HTTP ${response.status}). It may still be starting; please try again.`
    );
  }
}
type Competition = {
  title: string;
  category: string;
  description: string;
  prizePool: number;
  entryFee: number;
  maxParticipants: number;
  registeredCount: number;
  registrationClosesAt: string;
  registrationStatus: string;
  competitionStatus: string;
  remainingSpots: number;
  isFull: boolean;
};

type CompetitionTab = "About" | "Judging" | "Rules" | "Eligibility";

type ParticipantStatus = {
  registrationStatus: string;
  paymentStatus: string;
  submissionStatus: string | null;
  submittedAt: string | null;
  lastUpdatedAt: string | null;
};

export default function App() {
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [participantName, setParticipantName] = useState("");
  const [email, setEmail] = useState("");
  const [registering, setRegistering] = useState(false);

  const [activeTab, setActiveTab] = useState<CompetitionTab>("About");

  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [entryName, setEntryName] = useState("");
  const [entryEmail, setEntryEmail] = useState("");
  const [pickingVideo, setPickingVideo] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const [statusEmail, setStatusEmail] = useState("");
  const [statusOtp, setStatusOtp] = useState("");
  const [statusOtpSent, setStatusOtpSent] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [participantStatus, setParticipantStatus] =
    useState<ParticipantStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [statusProgress, setStatusProgress] = useState("");
  const [statusError, setStatusError] = useState("");

  async function loadCompetition() {
    try {
      setError("");

      const response = await fetch(
        `${API_BASE_URL}/competitions/dance-championship-2026`
      );

const text = await response.text();
console.log("Status:", response.status);
console.log("Response:", text);

const data = JSON.parse(text);
      if (!response.ok) {
        throw new Error(data.message || "Could not load competition.");
      }

      setCompetition(data);
    } catch {
      setError(
        "Could not load competition. Check that the backend is running and your phone is on the same Wi-Fi."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void loadCompetition();
    }, 0);
    return () => clearTimeout(initialLoad);
  }, []);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timeout = setTimeout(() => {
      setOtpCooldown((remaining) => Math.max(remaining - 1, 0));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [otpCooldown]);

  async function handleRegister() {
    if (!participantName.trim() || !email.trim()) {
      Alert.alert("Missing details", "Please enter your name and email.");
      return;
    }

    setRegistering(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/competitions/dance-championship-2026/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            participantName: participantName.trim(),
            email: email.trim().toLowerCase(),
          }),
        }
      );

const text = await response.text();
console.log("Status:", response.status);
console.log("Response:", text);

const data = JSON.parse(text);
      if (!response.ok) {
        throw new Error(data.message || "Registration failed.");
      }

      Alert.alert(
        "Registration created",
        "Your registration has been created. Payment is still pending."
      );

      setParticipantName("");
      setEmail("");
      await loadCompetition();
    } catch (err) {
      Alert.alert(
        "Registration failed",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setRegistering(false);
    }
  }

  function handleStatusEmailChange(value: string) {
    setStatusEmail(value);
    setStatusOtp("");
    setStatusOtpSent(false);
    setStatusMessage("");
    setOtpCooldown(0);
    setParticipantStatus(null);
    setStatusError("");
  }

  async function handleSendStatusOtp() {
    const normalizedEmail = statusEmail.trim().toLowerCase();
    const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

    if (!emailIsValid || normalizedEmail.length > 254) {
      setStatusError("Enter a valid email address.");
      return;
    }
    if (otpCooldown > 0) return;

    setLoadingStatus(true);
    setStatusProgress("Connecting to the server. The first request after idle can take longer.");
    setStatusError("");
    setParticipantStatus(null);
    setStatusMessage("");

    try {
      const { response, responseText } = await fetchWithTimeout(
        `${API_BASE_URL}/competitions/dance-championship-2026/status/send-otp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail }),
        },
        OTP_REQUEST_TIMEOUT_MS,
        "send_otp_request"
      );
      const data = readApiResponse(response, responseText);
      if (!response.ok) {
        throw new Error(data.message || "Could not send a verification code.");
      }

      setStatusOtpSent(true);
      setStatusOtp("");
      setStatusMessage(
        data.message ||
          "If the email is registered, a verification code will be sent."
      );
      setOtpCooldown(Math.max(60, Number(data.resendAfterSeconds) || 60));
    } catch (err) {
      setStatusError(
        err instanceof Error
          ? err.message
          : "Could not send a verification code. Please try again."
      );
    } finally {
      setLoadingStatus(false);
      setStatusProgress("");
    }
  }

  async function handleVerifyStatusOtp() {
    const normalizedEmail = statusEmail.trim().toLowerCase();
    const otp = statusOtp.trim();
    if (!/^\d{6}$/.test(otp)) {
      setStatusError("Enter the six-digit verification code.");
      return;
    }

    setLoadingStatus(true);
    setStatusProgress("Verifying your code and loading your registration status…");
    setStatusError("");
    setStatusMessage("");

    try {
      const { response: verifyResponse, responseText: verifyResponseText } = await fetchWithTimeout(
        `${API_BASE_URL}/competitions/dance-championship-2026/status/verify-otp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail, otp }),
        },
        STATUS_REQUEST_TIMEOUT_MS,
        "verify_otp_request"
      );
      const verification = readApiResponse(verifyResponse, verifyResponseText);
      if (!verifyResponse.ok) {
        throw new Error(
          verification.message || "The code is invalid or expired."
        );
      }

      const accessToken = verification.accessToken;
      if (
        typeof accessToken !== "string" ||
        verification.tokenType !== "Bearer"
      ) {
        throw new Error("The server returned an invalid verification response.");
      }

      const { response: statusResponse, responseText: statusResponseText } = await fetchWithTimeout(
        `${API_BASE_URL}/competitions/dance-championship-2026/status`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        STATUS_REQUEST_TIMEOUT_MS,
        "participant_status_request"
      );
      const data = readApiResponse(statusResponse, statusResponseText);
      if (!statusResponse.ok) {
        throw new Error(data.message || "Could not retrieve your status.");
      }

      setParticipantStatus(data);
      setStatusOtp("");
      setStatusOtpSent(false);
    } catch (err) {
      setStatusError(
        err instanceof Error
          ? err.message
          : "Could not verify the code. Please try again."
      );
    } finally {
      setLoadingStatus(false);
      setStatusProgress("");
    }
  }

  async function handleChooseVideo() {
    try {
      setPickingVideo(true);

      const pickerResult = await File.pickFileAsync({
        mimeTypes: ["video/*"],
      });

      // User cancelled the picker.
      if (pickerResult.canceled) {
        return;
      }

      // For a single file, Expo returns the selected File in "result".
      const file = pickerResult.result;

      if (!file) {
        Alert.alert("No video selected", "Please choose a video file.");
        return;
      }

      if (file.type && !file.type.startsWith("video/")) {
        Alert.alert("Invalid file", "Please select a video file.");
        return;
      }

      if (file.size > 100 * 1024 * 1024) {
        Alert.alert("Video too large", "Please select a video under 100 MB.");
        return;
      }

      setSelectedVideo(file);
    } catch (err) {
      Alert.alert(
        "Unable to select video",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setPickingVideo(false);
    }
  }

 async function handleUploadVideo() {
  if (!entryName.trim() || !entryEmail.trim()) {
    Alert.alert(
      "Missing details",
      "Enter your name and email before uploading."
    );
    return;
  }

  if (!selectedVideo) {
    Alert.alert("No video selected", "Please choose a dance video first.");
    return;
  }

  setUploadingVideo(true);

  try {
    const formData = new FormData();

    formData.append("participantName", entryName.trim());
    formData.append("email", entryEmail.trim().toLowerCase());
    formData.append("competitionSlug", "dance-championship-2026");
    formData.append("video", selectedVideo);

    const response = await expoFetch(
      `${API_BASE_URL}/entries/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    // Read response as text first so HTML/plain-text errors are visible.
    const responseText = await response.text();

    let data: any;

    try {
      data = JSON.parse(responseText);
    } catch {
      const preview = responseText.slice(0, 700);

      throw new Error(
        `Server returned non-JSON data.\nHTTP status: ${response.status}\nResponse: ${preview || "(empty response)"}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${
          data.message || "Video upload failed."
        }`
      );
    }

    Alert.alert(
      "Video uploaded",
      "Your video was saved on the backend. Payment status is unchanged."
    );

    setSelectedVideo(null);
    setEntryName("");
    setEntryEmail("");
  } catch (err) {
    Alert.alert(
      "Upload failed",
      err instanceof Error ? err.message : "Please try again."
    );
  } finally {
    setUploadingVideo(false);
  }
}
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#6558D3" />
        <Text style={styles.message}>Loading competition...</Text>
      </SafeAreaView>
    );
  }

  if (error || !competition) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.error}>
          {error || "Competition not found."}
        </Text>

        <Pressable style={styles.retryButton} onPress={loadCompetition}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const registrationClosed =
    competition.registrationStatus !== "open" || competition.isFull;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.category}>
          {competition.category.toUpperCase()}
        </Text>

        <Text style={styles.title}>{competition.title}</Text>
        <Text style={styles.description}>{competition.description}</Text>

        <View style={styles.statusRow}>
          <Text style={styles.status}>
            Registration: {competition.registrationStatus}
          </Text>

          <Text style={styles.status}>
            Event: {competition.competitionStatus}
          </Text>
        </View>

        {/* Competition summary */}
        <View style={styles.card}>
          <Text style={styles.label}>Prize Pool</Text>
          <Text style={styles.prize}>
            ₹{competition.prizePool.toLocaleString("en-IN")}
          </Text>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.label}>Entry Fee</Text>
            <Text style={styles.value}>₹{competition.entryFee}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Participants</Text>
            <Text style={styles.value}>
              {competition.registeredCount} / {competition.maxParticipants}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Slots Remaining</Text>
            <Text style={styles.value}>{competition.remainingSpots}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Registration Closes</Text>
            <Text style={styles.value}>
              {new Date(
                competition.registrationClosesAt
              ).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {/* Information tabs */}
        <View style={styles.tabsContainer}>
          {(
            ["About", "Judging", "Rules", "Eligibility"] as CompetitionTab[]
          ).map((tab) => (
            <Pressable
              key={tab}
              style={[
                styles.tabButton,
                activeTab === tab && styles.activeTabButton,
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.activeTabText,
                ]}
              >
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          {activeTab === "About" && (
            <>
              <Text style={styles.sectionTitle}>About the Competition</Text>
              <Text style={styles.description}>
                Show your talent and compete with dancers from across the
                community. Participants can showcase their dance performance
                and compete for the prize pool.
              </Text>
            </>
          )}

          {activeTab === "Judging" && (
            <>
              <Text style={styles.sectionTitle}>Judging Criteria</Text>
              <Text style={styles.description}>
                Performances will be evaluated based on creativity, technique,
                synchronization, stage presence, and overall performance.
              </Text>
            </>
          )}

          {activeTab === "Rules" && (
            <>
              <Text style={styles.sectionTitle}>Competition Rules</Text>
              <Text style={styles.description}>
                {"1. Submit an original dance performance.\n\n"}
                {
                  "2. Ensure that your video is clear and the full performance is visible.\n\n"
                }
                {
                  "3. Keep your performance appropriate for a community event.\n\n"
                }
                {
                  "4. Follow the competition's submission instructions.\n\n"
                }
                {
                  "5. The organizers' final decision will determine the winners."
                }
              </Text>
            </>
          )}

          {activeTab === "Eligibility" && (
            <>
              <Text style={styles.sectionTitle}>Eligibility</Text>
              <Text style={styles.description}>
                Participants should provide accurate registration details and
                follow the competition rules. Make sure you have permission
                to submit any music or content included in your performance.
              </Text>
            </>
          )}
        </View>

        {/* Judges */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Meet the Judges</Text>
          <Text style={styles.description}>
            Our judging panel will evaluate creativity, technique, and
            performance.
          </Text>

          <View style={styles.personRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>J1</Text>
            </View>

            <View style={styles.personInfo}>
              <Text style={styles.personName}>Judge One</Text>
              <Text style={styles.personRole}>Dance and choreography</Text>
            </View>
          </View>

          <View style={styles.personRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>J2</Text>
            </View>

            <View style={styles.personInfo}>
              <Text style={styles.personName}>Judge Two</Text>
              <Text style={styles.personRole}>Performance and technique</Text>
            </View>
          </View>
        </View>

        {/* Winners */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Winners</Text>
          <Text style={styles.description}>
            Winners will be announced after the competition ends.
          </Text>

          {[1, 2, 3].map((place) => (
            <View style={styles.winnerRow} key={place}>
              <Text style={styles.winnerMedal}>{place}</Text>

              <View style={styles.personInfo}>
                <Text style={styles.personName}>
                  {place === 1
                    ? "First Place"
                    : place === 2
                    ? "Second Place"
                    : "Third Place"}
                </Text>

                <Text style={styles.personRole}>
                  Winner announcement pending
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Upload entry */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Upload Your Entry</Text>
          <Text style={styles.description}>
            Enter your details and upload your dance performance video.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Participant name"
            value={entryName}
            onChangeText={setEntryName}
            autoCapitalize="words"
            editable={!uploadingVideo}
          />

          <TextInput
            style={styles.input}
            placeholder="Participant email"
            value={entryEmail}
            onChangeText={setEntryEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!uploadingVideo}
          />

          <Pressable
            style={[
              styles.secondaryButton,
              pickingVideo && styles.disabledButton,
            ]}
            onPress={handleChooseVideo}
            disabled={pickingVideo || uploadingVideo}
          >
            <Text style={styles.secondaryButtonText}>
              {pickingVideo ? "Opening files..." : "Choose Dance Video"}
            </Text>
          </Pressable>

          {selectedVideo && (
            <View style={styles.selectedFile}>
              <Text style={styles.selectedFileName} numberOfLines={2}>
                {selectedVideo.name}
              </Text>

              <Pressable onPress={() => setSelectedVideo(null)}>
                <Text style={styles.removeFile}>Remove</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            style={[
              styles.registerButton,
              uploadingVideo && styles.disabledButton,
            ]}
            onPress={handleUploadVideo}
            disabled={uploadingVideo || pickingVideo}
          >
            <Text style={styles.buttonText}>
              {uploadingVideo ? "Uploading..." : "Upload Entry"}
            </Text>
          </Pressable>

          <Text style={styles.uploadNote}>
            Maximum video size: 100 MB. The file will be saved on the backend
            computer. Uploading does not complete payment.
          </Text>
        </View>

        {/* Registration */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            Register for this competition
          </Text>

          <Text style={styles.formNote}>
            Enter your details to create a registration. Payment is not taken
            in this demo flow.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Full name"
            value={participantName}
            onChangeText={setParticipantName}
            autoCapitalize="words"
            editable={!registering && !registrationClosed}
          />

          <TextInput
            style={styles.input}
            placeholder="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!registering && !registrationClosed}
          />

          <Pressable
            style={[
              styles.registerButton,
              (registering || registrationClosed) && styles.disabledButton,
            ]}
            onPress={handleRegister}
            disabled={registering || registrationClosed}
          >
            <Text style={styles.buttonText}>
              {registering
                ? "Registering..."
                : competition.isFull
                ? "Competition Full"
                : competition.registrationStatus !== "open"
                ? "Registration Closed"
                : "Register Now"}
            </Text>
          </Pressable>
        </View>

        {/* Participant status */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>My Status</Text>
          <Text style={styles.description}>
            Check your registration, payment, and video review status using
            the email you registered with.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Registration email"
            value={statusEmail}
            onChangeText={handleStatusEmailChange}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loadingStatus && !participantStatus}
          />

          {loadingStatus && (
            <Text style={styles.statusInfo}>{statusProgress}</Text>
          )}

          {!statusOtpSent && !participantStatus && (
            <Pressable
              style={[
                styles.registerButton,
                loadingStatus && styles.disabledButton,
              ]}
              onPress={handleSendStatusOtp}
              disabled={loadingStatus}
            >
              <Text style={styles.buttonText}>
                {loadingStatus ? "Sending code..." : "Send OTP"}
              </Text>
            </Pressable>
          )}

          {statusOtpSent && !participantStatus && (
            <>
              <Text style={styles.statusInfo}>
                {statusMessage}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Six-digit verification code"
                value={statusOtp}
                onChangeText={(value) =>
                  setStatusOtp(value.replace(/\D/g, "").slice(0, 6))
                }
                keyboardType="number-pad"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={6}
                editable={!loadingStatus}
              />
              <Pressable
                style={[
                  styles.registerButton,
                  loadingStatus && styles.disabledButton,
                ]}
                onPress={handleVerifyStatusOtp}
                disabled={loadingStatus}
              >
                <Text style={styles.buttonText}>
                  {loadingStatus ? "Verifying..." : "Verify OTP"}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.resendStatusButton,
                  (loadingStatus || otpCooldown > 0) &&
                    styles.disabledStatusButton,
                ]}
                onPress={handleSendStatusOtp}
                disabled={loadingStatus || otpCooldown > 0}
              >
                <Text style={styles.resendStatusText}>
                  {otpCooldown > 0
                    ? `Resend code in ${Math.floor(otpCooldown / 60)
                        .toString()
                        .padStart(2, "0")}:${(otpCooldown % 60)
                        .toString()
                        .padStart(2, "0")}`
                    : "Resend code"}
                </Text>
              </Pressable>
            </>
          )}

          {participantStatus && (
            <Pressable
              style={styles.resendStatusButton}
              onPress={() => handleStatusEmailChange("")}
            >
              <Text style={styles.resendStatusText}>Check another email</Text>
            </Pressable>
          )}

          {statusError ? (
            <Text style={styles.errorText}>{statusError}</Text>
          ) : null}

          {participantStatus && (
            <View style={styles.statusDetails}>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Registration</Text>
                <Text style={styles.value}>
                  {participantStatus.registrationStatus.replace(/_/g, " ")}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.label}>Payment</Text>
                <Text style={styles.value}>
                  {participantStatus.paymentStatus}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.label}>Video review</Text>
                <Text style={styles.value}>
                  {participantStatus.submissionStatus
                    ? participantStatus.submissionStatus.replace(/_/g, " ")
                    : "Not submitted"}
                </Text>
              </View>

              {participantStatus.submittedAt ? (
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Submitted</Text>
                  <Text style={styles.value}>
                    {new Date(
                      participantStatus.submittedAt
                    ).toLocaleString()}
                  </Text>
                </View>
              ) : null}

              {participantStatus.lastUpdatedAt ? (
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Last updated</Text>
                  <Text style={styles.value}>
                    {new Date(
                      participantStatus.lastUpdatedAt
                    ).toLocaleString()}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        <Text style={styles.note}>
          Competition details are loaded from your Feedants backend.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F6FA",
  },
  content: {
    padding: 20,
    paddingTop: 32,
    paddingBottom: 36,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  message: {
    marginTop: 12,
    color: "#555",
  },
  error: {
    color: "#B42318",
    textAlign: "center",
  },
  errorText: {
    color: "#B42318",
    fontSize: 13,
    marginTop: 12,
    lineHeight: 19,
  },
  statusInfo: {
    color: "#6558D3",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  resendStatusButton: {
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  disabledStatusButton: {
    opacity: 0.55,
  },
  resendStatusText: {
    color: "#6558D3",
    fontSize: 14,
    fontWeight: "700",
  },
  statusDetails: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#EEEEEE",
  },
  category: {
    color: "#6558D3",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#171717",
    marginTop: 8,
  },
  description: {
    fontSize: 15,
    color: "#777",
    lineHeight: 22,
    marginTop: 10,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
  },
  status: {
    backgroundColor: "#E8E5FF",
    color: "#5145CD",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    marginTop: 24,
    elevation: 2,
  },
  label: {
    color: "#777",
    fontSize: 13,
  },
  prize: {
    fontSize: 32,
    fontWeight: "800",
    color: "#171717",
    marginTop: 5,
  },
  divider: {
    height: 1,
    backgroundColor: "#EEEEEE",
    marginVertical: 18,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  value: {
    color: "#222",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    flexShrink: 1,
  },
  tabsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 24,
  },
  tabButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  activeTabButton: {
    backgroundColor: "#6558D3",
    borderColor: "#6558D3",
  },
  tabText: {
    color: "#555",
    fontSize: 13,
    fontWeight: "600",
  },
  activeTabText: {
    color: "#FFFFFF",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#171717",
  },
  formNote: {
    color: "#777",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: "#DDDDDD",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 12,
  },
  registerButton: {
    backgroundColor: "#6558D3",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 16,
  },
  disabledButton: {
    backgroundColor: "#AAA5D9",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  retryButton: {
    backgroundColor: "#6558D3",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 16,
  },
  note: {
    textAlign: "center",
    color: "#888",
    fontSize: 12,
    marginTop: 20,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    gap: 12,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#E8E5FF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#6558D3",
    fontSize: 18,
    fontWeight: "700",
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
  },
  personRole: {
    fontSize: 14,
    color: "#777",
    marginTop: 5,
    lineHeight: 20,
  },
  winnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 20,
  },
  winnerMedal: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#FFF1C2",
    color: "#8A6200",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 22,
    fontWeight: "800",
    overflow: "hidden",
  },
  secondaryButton: {
    backgroundColor: "#EEEAFE",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 18,
  },
  secondaryButtonText: {
    color: "#6558D3",
    fontSize: 16,
    fontWeight: "700",
  },
  selectedFile: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    padding: 12,
    backgroundColor: "#F6F5FF",
    borderRadius: 10,
  },
  selectedFileName: {
    flex: 1,
    color: "#333",
    fontSize: 14,
    marginRight: 12,
  },
  removeFile: {
    color: "#D14343",
    fontWeight: "700",
  },
  uploadNote: {
    color: "#777",
    fontSize: 13,
    marginTop: 14,
    lineHeight: 19,
  },
});
